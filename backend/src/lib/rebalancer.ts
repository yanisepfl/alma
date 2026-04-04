/**
 * Rebalance Orchestrator
 *
 * Ties together: position monitoring → decision → calldata construction → Calibur batch.
 * This is the "brain" of the agent.
 */

import { type Address, type Hex } from 'viem';

import { type ChainConfig } from './config.js';
import {
  checkPositionStatus,
  getPositionOwner,
  type PositionStatus,
} from './position-monitor.js';
import { type PoolWhitelist } from './call-validator.js';
import {
  buildBurnCalldata,
  buildMintCalldata,
  computeNewRange,
  type CaliburCall,
} from './calldata-builders.js';
import { UniswapApiClient, type QuoteResponse } from './uniswap-api.js';
import {
  buildSignedBatchedCall,
  submitBatchedCall,
  isKeyRegistered,
  type SignedBatchedCall,
} from './calibur.js';

// Re-export CaliburCall so it's available from here
export type { CaliburCall } from './calldata-builders.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RebalanceDecision {
  shouldRebalance: boolean;
  reason: string;
  status: PositionStatus;
}

export interface RebalancePlan {
  decision: RebalanceDecision;
  burnCall: CaliburCall;
  swapCall: CaliburCall;
  mintCall: CaliburCall;
  newRange: { tickLower: number; tickUpper: number };
  swapQuote: QuoteResponse;
}

// ---------------------------------------------------------------------------
// 1. Decision — should we rebalance?
// ---------------------------------------------------------------------------

export interface RebalanceThresholds {
  /** Minimum % out of range to trigger (default: 5%) */
  minPercentOutOfRange: number;
  /** Minimum position liquidity to bother (default: 0 = any) */
  minLiquidity: bigint;
}

const DEFAULT_THRESHOLDS: RebalanceThresholds = {
  minPercentOutOfRange: 5,
  minLiquidity: 0n,
};

export async function evaluateRebalance(
  tokenId: bigint,
  config: ChainConfig,
  thresholds: RebalanceThresholds = DEFAULT_THRESHOLDS
): Promise<RebalanceDecision> {
  const status = await checkPositionStatus(tokenId, config);

  if (status.isInRange) {
    return {
      shouldRebalance: false,
      reason: `Position is in range (tick ${status.pool.tick} within [${status.position.tickLower}, ${status.position.tickUpper}])`,
      status,
    };
  }

  if (status.position.liquidity === 0n) {
    return {
      shouldRebalance: false,
      reason: 'Position has zero liquidity — nothing to rebalance',
      status,
    };
  }

  if (status.position.liquidity < thresholds.minLiquidity) {
    return {
      shouldRebalance: false,
      reason: `Position liquidity ${status.position.liquidity} below threshold ${thresholds.minLiquidity}`,
      status,
    };
  }

  if (status.percentOutOfRange < thresholds.minPercentOutOfRange) {
    return {
      shouldRebalance: false,
      reason: `Only ${status.percentOutOfRange.toFixed(1)}% out of range — below ${thresholds.minPercentOutOfRange}% threshold, may return`,
      status,
    };
  }

  return {
    shouldRebalance: true,
    reason: `Position is ${status.percentOutOfRange.toFixed(1)}% out of range (${status.ticksOutOfRange} ticks). Current tick: ${status.pool.tick}, range: [${status.position.tickLower}, ${status.position.tickUpper}]`,
    status,
  };
}

// ---------------------------------------------------------------------------
// 2. Plan — construct the full rebalance batch
// ---------------------------------------------------------------------------

export async function planRebalance(params: {
  decision: RebalanceDecision;
  config: ChainConfig;
  userEOA: Address;
  uniswapApi: UniswapApiClient;
  /** Token decimals: [currency0Decimals, currency1Decimals] */
  tokenDecimals: [number, number];
  /** Width multiplier for new range (default: 10 tick spacings each side) */
  rangeWidthMultiplier?: number;
}): Promise<RebalancePlan> {
  const { decision, config, userEOA, uniswapApi, tokenDecimals, rangeWidthMultiplier = 10 } = params;
  const { status } = decision;
  const { position, pool, poolId } = status;

  // Step 1: Build burn calldata
  const burn = buildBurnCalldata({
    position,
    pool,
    config,
    recipient: userEOA,
  });

  const burnCall: CaliburCall = {
    to: burn.to,
    value: burn.value,
    data: burn.calldata,
  };

  // Step 2: Determine which token we have excess of (the one we need to swap FROM)
  // When out of range below: we hold 100% token0, need to swap some to token1
  // When out of range above: we hold 100% token1, need to swap some to token0
  const currentTick = pool.tick;
  const outBelow = currentTick < position.tickLower;

  const tokenIn = outBelow ? position.poolKey.currency0 : position.poolKey.currency1;
  const tokenOut = outBelow ? position.poolKey.currency1 : position.poolKey.currency0;

  // For the quote, we need to estimate how much to swap.
  // After burn, we'll have all liquidity in one token. We swap ~50% to get a balanced ratio.
  // This is a simplification — a real agent would calculate the exact ratio for the new range.
  // For now, we use a placeholder amount that gets refined once we know the burn output.
  // TODO: In the real flow, we'd simulate the burn first to know exact amounts.

  // Step 3: Get swap quote from Uniswap API
  // NOTE: The actual swap amount depends on burn output, which we don't know until execution.
  // For planning, we use the Uniswap API quote with an estimated amount.
  // The real flow will use the swap_7702 endpoint for delegated execution.
  const swapQuote = await uniswapApi.quote({
    type: 'EXACT_INPUT',
    amount: '1000000', // Placeholder — real amount comes from burn simulation
    tokenInChainId: config.chainId,
    tokenOutChainId: config.chainId,
    tokenIn: tokenIn,
    tokenOut: tokenOut,
    swapper: userEOA,
    slippageTolerance: 0.5,
  });

  // Step 4: Get swap calldata via swap_7702
  const swapResponse = await uniswapApi.swap7702({
    quote: swapQuote.quote,
    permitData: swapQuote.permitData,
    smartContractDelegationAddress: config.contracts.calibur,
    includeGasInfo: true,
  });

  const swapCall: CaliburCall = {
    to: swapResponse.swap.to as Address,
    value: BigInt(swapResponse.swap.value || '0'),
    data: swapResponse.swap.data as Hex,
  };

  // Step 5: Compute new range centered on current tick
  const newRange = computeNewRange({
    currentTick: pool.tick,
    tickSpacing: position.poolKey.tickSpacing,
    widthMultiplier: rangeWidthMultiplier,
  });

  // Step 6: Build mint calldata
  // For the mint, we use the swap output + remaining token to create a balanced position.
  // Again, exact amounts depend on the swap output.
  const mintResult = buildMintCalldata({
    pool,
    poolKey: position.poolKey,
    config,
    tickLower: newRange.tickLower,
    tickUpper: newRange.tickUpper,
    amount0: 1000000n, // Placeholder — real amount from swap output
    amount1: 1000000n, // Placeholder
    token0Decimals: tokenDecimals[0],
    token1Decimals: tokenDecimals[1],
    recipient: userEOA,
    slippageBps: 100, // 1% for rebalance
  });

  const mintCall: CaliburCall = {
    to: mintResult.to,
    value: mintResult.value,
    data: mintResult.calldata,
  };

  return {
    decision,
    burnCall,
    swapCall,
    mintCall,
    newRange,
    swapQuote,
  };
}

// ---------------------------------------------------------------------------
// 3. Pre-flight checks
// ---------------------------------------------------------------------------

export async function preflight(params: {
  tokenId: bigint;
  userEOA: Address;
  agentAddress: Address;
  config: ChainConfig;
  poolWhitelist?: PoolWhitelist;
}): Promise<{ ok: boolean; issues: string[] }> {
  const { tokenId, userEOA, agentAddress, config, poolWhitelist } = params;
  const issues: string[] = [];

  // Check position ownership
  try {
    const owner = await getPositionOwner(tokenId, config);
    if (owner.toLowerCase() !== userEOA.toLowerCase()) {
      issues.push(`Position ${tokenId} owned by ${owner}, not ${userEOA}`);
    }
  } catch (e: any) {
    issues.push(`Cannot read position owner: ${e.message}`);
  }

  // Check agent key registration
  try {
    const registered = await isKeyRegistered(userEOA, agentAddress, config);
    if (!registered) {
      issues.push(`Agent key ${agentAddress} is not registered on user's Calibur delegation`);
    }
  } catch (e: any) {
    // This will fail if user hasn't delegated to Calibur yet
    issues.push(`Cannot check key registration (user may not be delegated to Calibur): ${e.message}`);
  }

  // Check pool is whitelisted
  if (poolWhitelist) {
    try {
      const status = await checkPositionStatus(tokenId, config);
      const poolValidation = poolWhitelist.validate(status.position.poolKey, `Position ${tokenId}`);
      if (!poolValidation.valid) {
        issues.push(poolValidation.reason);
      }
    } catch (e: any) {
      issues.push(`Cannot validate pool: ${e.message}`);
    }
  }

  return { ok: issues.length === 0, issues };
}
