/**
 * Calldata Builders — uses V4 SDK to construct burn/mint calldata.
 *
 * Key insight: V4 on Base uses WETH internally for native ETH pools.
 * The SDK handles this via Ether.onChain() + useNative option.
 * Manual ABI encoding of actions is unreliable — always use the SDK.
 */

import {
  type Address,
  type Hex,
  encodeFunctionData,
} from 'viem';
import { V4PositionManager, Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk';
import type { MintOptions, RemoveLiquidityOptions } from '@uniswap/v4-sdk';
import { Token, Percent, Ether } from '@uniswap/sdk-core';
import JSBI from 'jsbi';
import type { ChainConfig } from './config.js';
import type { PositionInfo, PoolState } from './position-monitor.js';

export type CaliburCall = { to: Address; value: bigint; data: Hex };

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// ---------------------------------------------------------------------------
// SDK Helpers
// ---------------------------------------------------------------------------

/** Create an SDK currency — uses Ether.onChain for native ETH (address 0). */
function sdkCurrency(address: string, chainId: number, decimals: number, symbol: string) {
  if (address.toLowerCase() === ZERO_ADDRESS) {
    return Ether.onChain(chainId);
  }
  return new Token(chainId, address, decimals, symbol);
}

/** Get TickMath from v3-sdk (v4-sdk doesn't export it). */
async function getTickMath() {
  const v3sdk = await import('@uniswap/v3-sdk');
  return (v3sdk as any).TickMath;
}

/** Build a V4Pool from on-chain state. */
async function buildV4Pool(
  position: PositionInfo,
  pool: PoolState,
  config: ChainConfig,
) {
  const TickMath = await getTickMath();
  const sqrtPriceX96 = JSBI.BigInt(pool.sqrtPriceX96.toString());
  const tick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);

  const currency0 = sdkCurrency(
    position.poolKey.currency0, config.chainId, 18, 'token0',
  );
  const currency1 = sdkCurrency(
    position.poolKey.currency1, config.chainId, 6, 'token1',
  );

  return new V4Pool(
    currency0 as any,
    currency1 as any,
    position.poolKey.fee,
    position.poolKey.tickSpacing,
    position.poolKey.hooks,
    sqrtPriceX96.toString(),
    JSBI.BigInt(pool.liquidity.toString()).toString(),
    tick,
  );
}

/** Detect if the pool involves native ETH. */
function hasNativeETH(poolKey: PositionInfo['poolKey']): boolean {
  return (
    poolKey.currency0.toLowerCase() === ZERO_ADDRESS ||
    poolKey.currency1.toLowerCase() === ZERO_ADDRESS
  );
}

// ---------------------------------------------------------------------------
// New Range
// ---------------------------------------------------------------------------

export function computeNewRange(params: {
  currentTick: number;
  tickSpacing: number;
  widthMultiplier: number;
}): { tickLower: number; tickUpper: number } {
  const { currentTick, tickSpacing, widthMultiplier } = params;
  const halfWidth = tickSpacing * widthMultiplier;
  const center = Math.round(currentTick / tickSpacing) * tickSpacing;
  return {
    tickLower: center - halfWidth,
    tickUpper: center + halfWidth,
  };
}

// ---------------------------------------------------------------------------
// Estimate burn amounts (for swap planning, before actual execution)
// ---------------------------------------------------------------------------

export async function estimateBurnAmounts(
  position: PositionInfo,
  pool: PoolState,
  config: ChainConfig,
): Promise<{ amount0: bigint; amount1: bigint }> {
  const v4Pool = await buildV4Pool(position, pool, config);
  const v4Position = new V4Position({
    pool: v4Pool,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    liquidity: JSBI.BigInt(position.liquidity.toString()),
  });

  return {
    amount0: BigInt(v4Position.amount0.quotient.toString()),
    amount1: BigInt(v4Position.amount1.quotient.toString()),
  };
}

// ---------------------------------------------------------------------------
// Build Burn (Decrease Liquidity) Calldata — via V4 SDK
// ---------------------------------------------------------------------------

export async function buildBurnCalldata(params: {
  position: PositionInfo;
  pool: PoolState;
  config: ChainConfig;
  recipient: Address;
  deadlineTimestamp: bigint;
  slippageBps?: number;
}): Promise<{ to: Address; value: bigint; calldata: Hex }> {
  const { position, pool, config, deadlineTimestamp, slippageBps = 5000 } = params;

  const v4Pool = await buildV4Pool(position, pool, config);
  const v4Position = new V4Position({
    pool: v4Pool,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    liquidity: JSBI.BigInt(position.liquidity.toString()),
  });

  const removeOptions: RemoveLiquidityOptions = {
    tokenId: Number(position.tokenId),
    liquidityPercentage: new Percent(100, 100), // 100% remove
    slippageTolerance: new Percent(slippageBps, 10_000),
    deadline: deadlineTimestamp.toString(),
    burnToken: false,
  };

  const methodParams = V4PositionManager.removeCallParameters(v4Position, removeOptions);

  return {
    to: config.contracts.positionManager as Address,
    value: BigInt(methodParams.value || '0'),
    calldata: methodParams.calldata as Hex,
  };
}

// ---------------------------------------------------------------------------
// Build Mint (Create Position) Calldata — via V4 SDK
// ---------------------------------------------------------------------------

export async function buildMintCalldata(params: {
  pool: PoolState;
  poolKey: PositionInfo['poolKey'];
  config: ChainConfig;
  tickLower: number;
  tickUpper: number;
  amount0: bigint;
  amount1: bigint;
  recipient: Address;
  deadlineTimestamp: bigint;
  slippageBps?: number;
}): Promise<{ to: Address; value: bigint; calldata: Hex; liquidity: string }> {
  const { pool, poolKey, config, tickLower, tickUpper, amount0, amount1, recipient, deadlineTimestamp, slippageBps = 200 } = params;

  // Build a synthetic PositionInfo to reuse buildV4Pool
  const syntheticPosition: PositionInfo = {
    tokenId: 0n,
    tickLower,
    tickUpper,
    liquidity: 0n,
    poolKey,
  };

  const v4Pool = await buildV4Pool(syntheticPosition, pool, config);

  // Determine which token has the larger amount to use as the input side
  // This matches the Alphix frontend pattern (fromAmount0 / fromAmount1)
  let v4Position: V4Position;
  if (amount0 > 0n && amount1 > 0n) {
    // Both tokens available — use amount0 as primary
    v4Position = V4Position.fromAmount0({
      pool: v4Pool,
      tickLower,
      tickUpper,
      amount0: JSBI.BigInt(amount0.toString()),
      useFullPrecision: true,
    });
  } else if (amount0 > 0n) {
    v4Position = V4Position.fromAmount0({
      pool: v4Pool,
      tickLower,
      tickUpper,
      amount0: JSBI.BigInt(amount0.toString()),
      useFullPrecision: true,
    });
  } else {
    v4Position = V4Position.fromAmount1({
      pool: v4Pool,
      tickLower,
      tickUpper,
      amount1: JSBI.BigInt(amount1.toString()),
    });
  }

  const isNative = hasNativeETH(poolKey);

  const mintOptions: MintOptions = {
    slippageTolerance: new Percent(slippageBps, 10_000),
    deadline: deadlineTimestamp.toString(),
    recipient,
    hookData: '0x',
    useNative: isNative ? Ether.onChain(config.chainId) : undefined,
  };

  const methodParams = V4PositionManager.addCallParameters(v4Position, mintOptions);

  return {
    to: config.contracts.positionManager as Address,
    value: BigInt(methodParams.value || '0'),
    calldata: methodParams.calldata as Hex,
    liquidity: v4Position.liquidity.toString(),
  };
}

// ---------------------------------------------------------------------------
// Build ERC20 Approve Calldata (for Permit2 flow)
// ---------------------------------------------------------------------------

const ERC20_APPROVE_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const PERMIT2_APPROVE_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
    ],
    outputs: [],
  },
] as const;

const MAX_UINT256 = 2n ** 256n - 1n;
const MAX_UINT160 = 2n ** 160n - 1n;
const MAX_UINT48 = 2n ** 48n - 1n;

export function buildApprovalCalls(
  tokens: Address[],
  spender: Address,
  permit2: Address,
): CaliburCall[] {
  const calls: CaliburCall[] = [];

  for (const token of tokens) {
    if (token.toLowerCase() === ZERO_ADDRESS.toLowerCase()) continue;
    // ERC20 -> approve Permit2
    calls.push({
      to: token,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [permit2, MAX_UINT256],
      }),
    });
    // Permit2 -> approve spender
    calls.push({
      to: permit2,
      value: 0n,
      data: encodeFunctionData({
        abi: PERMIT2_APPROVE_ABI,
        functionName: 'approve',
        args: [token, spender, MAX_UINT160, Number(MAX_UINT48)],
      }),
    });
  }

  return calls;
}
