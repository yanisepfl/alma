/**
 * Calldata Builders — construct burn/mint calldata for Uniswap V4 PositionManager.
 *
 * Uses V4's modifyLiquidities(unlockData, deadline) with action-based encoding:
 *   unlockData = abi.encode(bytes actions, bytes[] params)
 *
 * Each action is a 1-byte code, with corresponding ABI-encoded params.
 */

import {
  type Address,
  type Hex,
  encodeFunctionData,
  encodeAbiParameters,
  concat,
  toHex,
} from 'viem';
import type { ChainConfig } from './config.js';
import type { PositionInfo, PoolState } from './position-monitor.js';
import { positionManagerAbi } from '../abis/position-manager.js';

export type CaliburCall = { to: Address; value: bigint; data: Hex };

// PositionManager Actions enum values (from V4 Actions.sol — hex-based numbering)
const ACTIONS = {
  INCREASE_LIQUIDITY: 0x00,
  DECREASE_LIQUIDITY: 0x01,
  MINT_POSITION: 0x02,
  BURN_POSITION: 0x03,
  CLOSE_CURRENCY: 0x10,
  CLEAR_OR_TAKE: 0x11,
  SWEEP: 0x12,
  SETTLE: 0x13,
  SETTLE_ALL: 0x14,
  SETTLE_PAIR: 0x15,
  TAKE: 0x16,
  TAKE_ALL: 0x17,
  TAKE_PAIR: 0x18,
  TAKE_PORTION: 0x19,
};

// ---------------------------------------------------------------------------
// Tick Math — port of Uniswap V3/V4 TickMath.getSqrtRatioAtTick
// ---------------------------------------------------------------------------

const Q96 = 2n ** 96n;

/** Convert a tick to sqrtPriceX96 (Q96 fixed-point). Exact port of TickMath. */
export function tickToSqrtPriceX96(tick: number): bigint {
  const absTick = Math.abs(tick);
  if (absTick > 887272) throw new Error(`Tick ${tick} out of range`);

  let ratio = (absTick & 0x1) !== 0
    ? 0xfffcb933bd6fad37aa2d162d1a594001n
    : 0x100000000000000000000000000000000n;

  if (absTick & 0x2) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n;
  if (absTick & 0x4) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n;
  if (absTick & 0x8) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n;
  if (absTick & 0x10) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n;
  if (absTick & 0x20) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n;
  if (absTick & 0x40) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n;
  if (absTick & 0x80) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n;
  if (absTick & 0x100) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n;
  if (absTick & 0x200) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n;
  if (absTick & 0x400) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n;
  if (absTick & 0x800) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n;
  if (absTick & 0x1000) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n;
  if (absTick & 0x2000) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n;
  if (absTick & 0x4000) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n;
  if (absTick & 0x8000) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n;
  if (absTick & 0x10000) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n;
  if (absTick & 0x20000) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n;
  if (absTick & 0x40000) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n;
  if (absTick & 0x80000) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n;

  if (tick > 0) ratio = (2n ** 256n - 1n) / ratio;

  // Convert Q128 → Q96, rounding up
  return (ratio >> 32n) + (ratio % (1n << 32n) > 0n ? 1n : 0n);
}

// ---------------------------------------------------------------------------
// Liquidity Math
// ---------------------------------------------------------------------------

/** Calculate maximum liquidity mintable for given amounts at a price within a range. */
export function maxLiquidityForAmounts(
  sqrtPriceX96: bigint,
  sqrtPriceLowerX96: bigint,
  sqrtPriceUpperX96: bigint,
  amount0: bigint,
  amount1: bigint,
): bigint {
  if (sqrtPriceX96 <= sqrtPriceLowerX96) {
    // Current price below range — position is 100% token0
    const num = amount0 * sqrtPriceLowerX96 * sqrtPriceUpperX96;
    const den = Q96 * (sqrtPriceUpperX96 - sqrtPriceLowerX96);
    return den > 0n ? num / den : 0n;
  } else if (sqrtPriceX96 >= sqrtPriceUpperX96) {
    // Current price above range — position is 100% token1
    const den = sqrtPriceUpperX96 - sqrtPriceLowerX96;
    return den > 0n ? (amount1 * Q96) / den : 0n;
  } else {
    // Current price in range — use min of both
    const l0Num = amount0 * sqrtPriceX96 * sqrtPriceUpperX96;
    const l0Den = Q96 * (sqrtPriceUpperX96 - sqrtPriceX96);
    const l0 = l0Den > 0n ? l0Num / l0Den : 0n;

    const l1Den = sqrtPriceX96 - sqrtPriceLowerX96;
    const l1 = l1Den > 0n ? (amount1 * Q96) / l1Den : 0n;

    return l0 < l1 ? l0 : l1;
  }
}

/** Estimate token amounts returned from burning a position's full liquidity. */
export function estimateBurnAmounts(
  position: PositionInfo,
  pool: PoolState,
): { amount0: bigint; amount1: bigint } {
  const sqrtPrice = pool.sqrtPriceX96;
  const sqrtLower = tickToSqrtPriceX96(position.tickLower);
  const sqrtUpper = tickToSqrtPriceX96(position.tickUpper);
  const L = position.liquidity;

  let amount0 = 0n;
  let amount1 = 0n;

  if (sqrtPrice <= sqrtLower) {
    // Below range — 100% token0
    amount0 = (L * Q96 * (sqrtUpper - sqrtLower)) / (sqrtLower * sqrtUpper);
  } else if (sqrtPrice >= sqrtUpper) {
    // Above range — 100% token1
    amount1 = (L * (sqrtUpper - sqrtLower)) / Q96;
  } else {
    // In range
    amount0 = (L * Q96 * (sqrtUpper - sqrtPrice)) / (sqrtPrice * sqrtUpper);
    amount1 = (L * (sqrtPrice - sqrtLower)) / Q96;
  }

  return { amount0, amount1 };
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
// Encode actions + params into V4 modifyLiquidities unlockData
// ---------------------------------------------------------------------------

function encodeUnlockData(actionCodes: number[], params: Hex[]): Hex {
  // actions = packed bytes (1 byte per action)
  const actionsBytes = concat(actionCodes.map((a) => toHex(a, { size: 1 }))) as Hex;

  // unlockData = abi.encode(bytes actions, bytes[] params)
  return encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    [actionsBytes, params],
  );
}

// ---------------------------------------------------------------------------
// Build Burn (Decrease Liquidity) Calldata
// ---------------------------------------------------------------------------

/**
 * Build calldata to remove ALL liquidity from a position.
 *
 * Actions: DECREASE_LIQUIDITY → CLOSE_CURRENCY(token0) → CLOSE_CURRENCY(token1)
 *
 * CLOSE_CURRENCY handles taking whatever tokens are owed after the decrease,
 * so we don't need to know exact output amounts upfront.
 */
export function buildBurnCalldata(params: {
  position: PositionInfo;
  pool: PoolState;
  config: ChainConfig;
  recipient: Address;
  deadlineSeconds?: number;
}): { to: Address; value: bigint; calldata: Hex } {
  const { position, config, deadlineSeconds = 300 } = params;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);

  // DECREASE_LIQUIDITY params:
  // abi.encode(uint256 tokenId, uint256 liquidity, uint128 amount0Min, uint128 amount1Min, bytes hookData)
  const decreaseParams = encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'bytes' },
    ],
    [
      position.tokenId,
      position.liquidity,   // Remove ALL liquidity
      0n,                    // amount0Min (0 for simplicity, add slippage in production)
      0n,                    // amount1Min
      '0x' as Hex,           // hookData
    ],
  );

  // CLOSE_CURRENCY params: abi.encode(address currency)
  const close0Params = encodeAbiParameters(
    [{ type: 'address' }],
    [position.poolKey.currency0],
  );
  const close1Params = encodeAbiParameters(
    [{ type: 'address' }],
    [position.poolKey.currency1],
  );

  const unlockData = encodeUnlockData(
    [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.CLOSE_CURRENCY, ACTIONS.CLOSE_CURRENCY],
    [decreaseParams, close0Params, close1Params],
  );

  const calldata = encodeFunctionData({
    abi: positionManagerAbi,
    functionName: 'modifyLiquidities',
    args: [unlockData, deadline],
  });

  return {
    to: config.contracts.positionManager as Address,
    value: 0n,
    calldata,
  };
}

// ---------------------------------------------------------------------------
// Build Mint (New Position) Calldata
// ---------------------------------------------------------------------------

/**
 * Build calldata to mint a new position.
 *
 * Actions: MINT_POSITION → CLOSE_CURRENCY(token0) → CLOSE_CURRENCY(token1)
 *
 * Liquidity is calculated from the provided amounts using maxLiquidityForAmounts.
 * CLOSE_CURRENCY handles settling (paying in) required tokens and refunding excess.
 */
export function buildMintCalldata(params: {
  pool: PoolState;
  poolKey: PositionInfo['poolKey'];
  config: ChainConfig;
  tickLower: number;
  tickUpper: number;
  amount0: bigint;
  amount1: bigint;
  token0Decimals: number;
  token1Decimals: number;
  recipient: Address;
  slippageBps: number;
  deadlineSeconds?: number;
}): { to: Address; value: bigint; calldata: Hex; liquidity: bigint } {
  const { pool, poolKey, config, tickLower, tickUpper, amount0, amount1, recipient, slippageBps, deadlineSeconds = 300 } = params;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);

  // Calculate sqrtPrice bounds for the new range
  const sqrtPriceLower = tickToSqrtPriceX96(tickLower);
  const sqrtPriceUpper = tickToSqrtPriceX96(tickUpper);

  // Calculate liquidity from available amounts
  const liquidity = maxLiquidityForAmounts(
    pool.sqrtPriceX96,
    sqrtPriceLower,
    sqrtPriceUpper,
    amount0,
    amount1,
  );

  if (liquidity === 0n) {
    console.warn('[mint] Calculated liquidity is 0 — amounts may be too small for the range');
  }

  // Apply slippage to max amounts
  const slippageMultiplier = 10_000n + BigInt(slippageBps);
  const amount0Max = (amount0 * slippageMultiplier) / 10_000n;
  const amount1Max = (amount1 * slippageMultiplier) / 10_000n;

  // MINT_POSITION params:
  // abi.encode(PoolKey, int24 tickLower, int24 tickUpper, uint256 liquidity,
  //            uint128 amount0Max, uint128 amount1Max, address owner, bytes hookData)
  const mintParams = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      { type: 'int24' },
      { type: 'int24' },
      { type: 'uint256' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'address' },
      { type: 'bytes' },
    ],
    [
      {
        currency0: poolKey.currency0,
        currency1: poolKey.currency1,
        fee: poolKey.fee,
        tickSpacing: poolKey.tickSpacing,
        hooks: poolKey.hooks,
      },
      tickLower,
      tickUpper,
      liquidity,
      amount0Max,
      amount1Max,
      recipient,
      '0x' as Hex,
    ],
  );

  // CLOSE_CURRENCY params
  const close0Params = encodeAbiParameters(
    [{ type: 'address' }],
    [poolKey.currency0],
  );
  const close1Params = encodeAbiParameters(
    [{ type: 'address' }],
    [poolKey.currency1],
  );

  const unlockData = encodeUnlockData(
    [ACTIONS.MINT_POSITION, ACTIONS.CLOSE_CURRENCY, ACTIONS.CLOSE_CURRENCY],
    [mintParams, close0Params, close1Params],
  );

  const calldata = encodeFunctionData({
    abi: positionManagerAbi,
    functionName: 'modifyLiquidities',
    args: [unlockData, deadline],
  });

  // If currency0 is native ETH, we might need to send value
  const isNativeETH = poolKey.currency0 === '0x0000000000000000000000000000000000000000';
  const value = isNativeETH ? amount0Max : 0n;

  return {
    to: config.contracts.positionManager as Address,
    value,
    calldata,
    liquidity,
  };
}

// ---------------------------------------------------------------------------
// Build ERC20 Approve Calldata
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

/** Build ERC20 approve(spender, MAX) calldata. */
export function buildApproveCalldata(
  token: Address,
  spender: Address,
): CaliburCall {
  return {
    to: token,
    value: 0n,
    data: encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [spender, MAX_UINT256],
    }),
  };
}

/** Build Permit2 approve(token, spender, maxAmount, maxExpiry) calldata. */
export function buildPermit2ApproveCalldata(
  permit2: Address,
  token: Address,
  spender: Address,
): CaliburCall {
  return {
    to: permit2,
    value: 0n,
    data: encodeFunctionData({
      abi: PERMIT2_APPROVE_ABI,
      functionName: 'approve',
      args: [token, spender, MAX_UINT160, Number(MAX_UINT48)],
    }),
  };
}

/**
 * Build the full set of approval calls needed before a mint or swap.
 * Includes ERC20 approve for Permit2, and Permit2 approve for the spender.
 * Skips native ETH (address 0).
 */
export function buildApprovalCalls(
  tokens: Address[],
  spender: Address,
  permit2: Address,
): CaliburCall[] {
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
  const calls: CaliburCall[] = [];

  for (const token of tokens) {
    if (token.toLowerCase() === ZERO_ADDRESS.toLowerCase()) continue;
    // ERC20 → approve Permit2
    calls.push(buildApproveCalldata(token, permit2));
    // Permit2 → approve spender (e.g. PositionManager or UniversalRouter)
    calls.push(buildPermit2ApproveCalldata(permit2, token, spender));
  }

  return calls;
}
