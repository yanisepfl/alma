/**
 * Calldata Builders — construct burn/mint calldata for Uniswap V4 PositionManager.
 * Minimal implementation for hackathon demo.
 */

import { type Address, type Hex, encodeFunctionData, encodeAbiParameters } from 'viem';
import type { ChainConfig } from './config.js';
import type { PositionInfo, PoolState } from './position-monitor.js';

export type CaliburCall = { to: Address; value: bigint; data: Hex };

// PositionManager Actions enum values (from V4 SDK)
const ACTIONS = {
  DECREASE_LIQUIDITY: 1,
  INCREASE_LIQUIDITY: 0,
  MINT_POSITION: 2,
  BURN_POSITION: 3,
  SETTLE: 18,
  TAKE: 19,
  CLOSE_CURRENCY: 20,
  CLEAR_OR_TAKE: 21,
  SWEEP: 22,
};

export function computeNewRange(params: {
  currentTick: number;
  tickSpacing: number;
  widthMultiplier: number;
}): { tickLower: number; tickUpper: number } {
  const { currentTick, tickSpacing, widthMultiplier } = params;
  const halfWidth = tickSpacing * widthMultiplier;
  // Align to tick spacing
  const center = Math.round(currentTick / tickSpacing) * tickSpacing;
  return {
    tickLower: center - halfWidth,
    tickUpper: center + halfWidth,
  };
}

export function buildBurnCalldata(_params: {
  position: PositionInfo;
  pool: PoolState;
  config: ChainConfig;
  recipient: Address;
}): { to: Address; value: bigint; calldata: Hex } {
  // TODO: Build proper V4 PositionManager modifyLiquidities calldata
  // For hackathon, this is a placeholder — real implementation uses Actions encoding
  return {
    to: _params.config.contracts.positionManager as Address,
    value: 0n,
    calldata: '0x' as Hex,
  };
}

export function buildMintCalldata(_params: {
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
}): { to: Address; value: bigint; calldata: Hex } {
  // TODO: Build proper V4 PositionManager modifyLiquidities calldata
  return {
    to: _params.config.contracts.positionManager as Address,
    value: 0n,
    calldata: '0x' as Hex,
  };
}
