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
import { V4PositionManager, V4PositionPlanner, Pool as V4Pool, Position as V4Position, toHex as sdkToHex } from '@uniswap/v4-sdk';
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
/** Token decimals lookup. */
function getDecimals(address: string, config: ChainConfig): number {
  const addr = address.toLowerCase();
  if (addr === ZERO_ADDRESS) return 18; // ETH
  // Check known tokens from config
  for (const [, t] of Object.entries(config.tokens)) {
    if (t.address.toLowerCase() === addr) return t.decimals;
  }
  // Common Base tokens
  if (addr === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') return 6; // USDC
  if (addr === '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf') return 8; // cbBTC
  return 18; // default
}

async function buildV4Pool(
  position: PositionInfo,
  pool: PoolState,
  config: ChainConfig,
) {
  // Use on-chain tick directly — TickMath.getTickAtSqrtRatio can differ
  // due to rounding and causes PRICE_BOUNDS errors
  const tick = pool.tick;

  const currency0 = sdkCurrency(
    position.poolKey.currency0, config.chainId,
    getDecimals(position.poolKey.currency0, config), 'token0',
  );
  const currency1 = sdkCurrency(
    position.poolKey.currency1, config.chainId,
    getDecimals(position.poolKey.currency1, config), 'token1',
  );

  return new V4Pool(
    currency0 as any,
    currency1 as any,
    position.poolKey.fee,
    position.poolKey.tickSpacing,
    position.poolKey.hooks,
    JSBI.BigInt(pool.sqrtPriceX96.toString()).toString(),
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
  const { position, pool, config, recipient, deadlineTimestamp } = params;

  const v4Pool = await buildV4Pool(position, pool, config);

  // Build SDK tokens for takePair/sweep
  const dec0 = getDecimals(position.poolKey.currency0, config);
  const dec1 = getDecimals(position.poolKey.currency1, config);
  const sdkToken0 = new Token(config.chainId, position.poolKey.currency0, dec0, 'T0');
  const sdkToken1 = new Token(config.chainId, position.poolKey.currency1, dec1, 'T1');
  const [sorted0, sorted1] = sdkToken0.sortsBefore(sdkToken1)
    ? [sdkToken0, sdkToken1] : [sdkToken1, sdkToken0];

  // Use Planner approach (matching Alphix frontend pattern)
  const planner = new V4PositionPlanner();
  const tokenIdHex = sdkToHex(position.tokenId.toString());
  const zero = JSBI.BigInt(0);

  // Full burn — remove all liquidity and burn the NFT
  planner.addBurn(tokenIdHex, zero, zero, '0x');

  // Take both tokens back to recipient
  planner.addTakePair(sorted0, sorted1, recipient);

  // Sweep native ETH if pool involves it
  if (hasNativeETH(position.poolKey)) {
    const nativeToken = position.poolKey.currency0.toLowerCase() === ZERO_ADDRESS
      ? sorted0.address.toLowerCase() === ZERO_ADDRESS ? sorted0 : sorted1
      : sorted1.address.toLowerCase() === ZERO_ADDRESS ? sorted1 : sorted0;
    planner.addSweep(nativeToken, recipient);
  }

  const deadline = deadlineTimestamp.toString();
  const unlockData = planner.finalize();

  const calldata = V4PositionManager.encodeModifyLiquidities(
    unlockData as Hex,
    deadline,
  );

  return {
    to: config.contracts.positionManager as Address,
    value: 0n,
    calldata: calldata as Hex,
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
