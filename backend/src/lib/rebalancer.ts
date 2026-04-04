/**
 * Rebalance Orchestrator
 *
 * Ties together: position monitoring -> decision -> API calls -> execution.
 *
 * Rebalance flow (single batched transaction via encode_7702):
 *   1. Build burn calldata (V4 PositionManager)
 *   2. Get swap calldata from Uniswap Trade API (/quote + /swap_7702)
 *   3. Build mint calldata (V4 PositionManager)
 *   4. Batch all via Uniswap /wallet/encode_7702
 *   5. Submit encoded transaction to user's delegated EOA
 */

import {
  type Address,
  type Hex,
  type Account,
  type WalletClient,
  type PublicClient,
} from 'viem';

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
  buildApprovalCalls,
  computeNewRange,
  estimateBurnAmounts,
  type CaliburCall,
} from './calldata-builders.js';
import { UniswapApiClient } from './uniswap-api.js';
import {
  buildSignedBatchedCall,
  submitBatchedCall,
  isKeyRegistered,
} from './calibur.js';

export type { CaliburCall } from './calldata-builders.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RebalanceDecision {
  shouldRebalance: boolean;
  reason: string;
  status: PositionStatus;
}

export interface RebalanceResult {
  success: boolean;
  tokenId: string;
  txHash?: string;
  blockNumber?: bigint;
  newRange?: { tickLower: number; tickUpper: number };
  error?: string;
  details?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// 1. Decision — should we rebalance?
// ---------------------------------------------------------------------------

export interface RebalanceThresholds {
  minPercentOutOfRange: number;
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
      reason: `Only ${status.percentOutOfRange.toFixed(1)}% out of range — below ${thresholds.minPercentOutOfRange}% threshold`,
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
// 2. Execute — single-batch rebalance via Uniswap encode_7702
// ---------------------------------------------------------------------------

export async function executeRebalance(params: {
  tokenId: bigint;
  userEOA: Address;
  decision: RebalanceDecision;
  config: ChainConfig;
  agentAccount: Account;
  walletClient: WalletClient;
  publicClient: PublicClient;
  uniswapApi: UniswapApiClient;
  rangeWidthMultiplier?: number;
}): Promise<RebalanceResult> {
  const {
    tokenId,
    userEOA,
    decision,
    config,
    agentAccount,
    walletClient,
    publicClient,
    uniswapApi,
    rangeWidthMultiplier = 10,
  } = params;

  const { status } = decision;
  const { position, pool } = status;
  const tokenIdStr = tokenId.toString();

  const log = (msg: string) => console.log(`  [rebalance #${tokenIdStr}] ${msg}`);

  try {
    // ─── PRE-CHECK: Verify Calibur delegation ────────────────────────────

    log('Pre-check: Verifying Calibur delegation...');
    try {
      const registered = await isKeyRegistered(userEOA, agentAccount.address, config);
      if (!registered) {
        log('Agent key NOT registered — user must delegate via frontend first');
        return {
          success: false, tokenId: tokenIdStr,
          error: 'Agent key not registered. User must delegate via frontend first.',
        };
      }
      log('Agent key registered');
    } catch (e: any) {
      const shortErr = e.shortMessage || e.message?.split('\n')[0] || 'unknown';
      log(`Delegation check failed: ${shortErr}`);
      return {
        success: false, tokenId: tokenIdStr,
        error: `User EOA not delegated to Calibur: ${shortErr}`,
      };
    }

    // ─── Compute shared deadline ────────────────────────────────────────

    const deadlineTimestamp = BigInt(Math.floor(Date.now() / 1000) + 300);

    // ─── STEP 1: Build burn calldata ─────────────────────────────────────

    log('Building burn calldata (V4 SDK)...');
    const burnEstimate = await estimateBurnAmounts(position, pool, config);
    log(`  Estimated burn output: ${burnEstimate.amount0} token0, ${burnEstimate.amount1} token1`);

    // Skip only truly empty positions
    if (burnEstimate.amount0 === 0n && burnEstimate.amount1 === 0n) {
      log('  Both burn amounts are zero. Skipping.');
      return { success: false, tokenId: tokenIdStr, error: 'Nothing to rebalance' };
    }

    const burn = await buildBurnCalldata({
      position,
      pool,
      config,
      recipient: userEOA,
      deadlineTimestamp,
    });
    log(`  Burn calldata: ${burn.calldata.length} chars`);

    // ─── STEP 2: Get swap calldata from Uniswap API ─────────────────────

    log('Getting swap calldata from Uniswap API...');
    const currentTick = pool.tick;
    const outBelow = currentTick < position.tickLower;
    const tokenIn = outBelow ? position.poolKey.currency0 : position.poolKey.currency1;
    const tokenOut = outBelow ? position.poolKey.currency1 : position.poolKey.currency0;
    const totalIn = outBelow ? burnEstimate.amount0 : burnEstimate.amount1;
    const swapAmount = totalIn / 2n;

    let swapCall: { to: string; data: string; value: string } | null = null;
    let swapOutputAmount = 0n;

    if (swapAmount > 0n) {
      log(`  Direction: ${outBelow ? 'token0 -> token1' : 'token1 -> token0'}`);
      log(`  Swap amount: ${swapAmount}`);

      const quote = await uniswapApi.quote({
        type: 'EXACT_INPUT',
        amount: swapAmount.toString(),
        tokenInChainId: config.chainId,
        tokenOutChainId: config.chainId,
        tokenIn,
        tokenOut,
        swapper: userEOA,
        slippageTolerance: 0.5,
      });

      swapOutputAmount = BigInt(quote.quote.output.amount);
      log(`  Quote: ${quote.quote.input.amount} in -> ${swapOutputAmount} out`);
      log(`  Route: ${quote.quote.routeString}`);

      // Use /swap (not /swap_7702) to get raw UniversalRouter calldata
      // swap_7702 wraps in an execute(BatchedCall) targeting the EOA which
      // doesn't work inside our Calibur signed batch
      // Don't pass permitData — we handle approvals ourselves via Calibur batch.
      // The /swap endpoint requires a signature alongside permitData.
      const swapResponse = await uniswapApi.swap({ quote: quote.quote });

      swapCall = {
        to: swapResponse.swap.to,
        data: swapResponse.swap.data,
        value: swapResponse.swap.value || '0x0',
      };
      log(`  Swap calldata ready (target: ${swapCall.to})`);
    } else {
      log('  No tokens to swap — skipping');
    }

    // ─── STEP 3: Build mint calldata ─────────────────────────────────────

    log('Building mint calldata...');

    // Estimate post-swap amounts
    // outBelow: we hold token0, swap half to token1 → keep remaining token0 + received token1
    // outAbove: we hold token1, swap half to token0 → received token0 + keep remaining token1
    const postSwapAmount0 = outBelow ? (totalIn - swapAmount) : swapOutputAmount;
    const postSwapAmount1 = outBelow ? swapOutputAmount : (totalIn - swapAmount);
    log(`  Post-swap estimates: ${postSwapAmount0} token0, ${postSwapAmount1} token1`);

    const mintApprovals = buildApprovalCalls(
      [position.poolKey.currency0, position.poolKey.currency1],
      config.contracts.positionManager,
      config.contracts.permit2,
    );

    // Try progressively narrower ranges if amounts are too small for the default width
    let mint: Awaited<ReturnType<typeof buildMintCalldata>> | null = null;
    let newRange = { tickLower: 0, tickUpper: 0 };
    for (const multiplier of [rangeWidthMultiplier, 5, 2, 1]) {
      newRange = computeNewRange({
        currentTick: pool.tick,
        tickSpacing: position.poolKey.tickSpacing,
        widthMultiplier: multiplier,
      });
      log(`  Trying range: [${newRange.tickLower}, ${newRange.tickUpper}] (width multiplier: ${multiplier})`);
      try {
        mint = await buildMintCalldata({
          pool,
          poolKey: position.poolKey,
          config,
          tickLower: newRange.tickLower,
          tickUpper: newRange.tickUpper,
          amount0: postSwapAmount0,
          amount1: postSwapAmount1,
          recipient: userEOA,
          deadlineTimestamp,
          slippageBps: 2000,
        });
        if (mint.liquidity !== '0') break;
        log(`  Liquidity is 0, trying narrower range...`);
        mint = null;
      } catch (e: any) {
        if (e.message?.includes('ZERO_LIQUIDITY')) {
          log(`  ZERO_LIQUIDITY at multiplier ${multiplier}, trying narrower...`);
          continue;
        }
        throw e;
      }
    }

    if (!mint) {
      log('  Could not create position with non-zero liquidity at any range width');
      return {
        success: false, tokenId: tokenIdStr,
        error: 'Amounts too small to create position even at narrowest range',
      };
    }
    log(`  Mint calldata: ${mint.calldata.length} chars, liquidity: ${mint.liquidity}`);

    // ─── STEP 4: Batch all calls into single Calibur SignedBatchedCall ──

    log('Batching calls into Calibur signed batch...');

    const batchCalls: CaliburCall[] = [];

    // Burn
    batchCalls.push({ to: burn.to, value: burn.value, data: burn.calldata });

    // Swap approvals + swap
    if (swapCall) {
      const swapApprovals = buildApprovalCalls(
        [tokenIn],
        config.contracts.universalRouter,
        config.contracts.permit2,
      );
      for (const a of swapApprovals) batchCalls.push(a);
      batchCalls.push({
        to: swapCall.to as Address,
        value: BigInt(swapCall.value || '0'),
        data: swapCall.data as Hex,
      });
    }

    // Mint approvals + mint
    for (const a of mintApprovals) batchCalls.push(a);
    batchCalls.push({ to: mint.to, value: mint.value, data: mint.calldata });

    log(`  Total calls in batch: ${batchCalls.length}`);

    // Sign via Calibur
    const { signedCall, wrappedSignature } = await buildSignedBatchedCall({
      userEOA,
      agentAccount,
      calls: batchCalls,
      config,
      skipValidation: true,
    });

    log(`  Signed (nonce: ${signedCall.nonce}, deadline: ${signedCall.deadline})`);

    // ─── STEP 5: Submit via Calibur execute ──────────────────────────────

    log('Submitting via Calibur...');

    const txHash = await submitBatchedCall({
      userEOA,
      signedCall,
      wrappedSignature,
      walletClient,
      config,
    });

    log(`  TX submitted: ${txHash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    const success = receipt.status === 'success';

    log(`  ${success ? 'CONFIRMED' : 'REVERTED'} in block ${receipt.blockNumber} (gas: ${receipt.gasUsed})`);

    return {
      success,
      tokenId: tokenIdStr,
      txHash,
      blockNumber: receipt.blockNumber,
      newRange: success ? newRange : undefined,
      error: success ? undefined : 'Transaction reverted',
      details: {
        callCount: batchCalls.length,
        gasUsed: receipt.gasUsed.toString(),
        burnEstimate: { amount0: burnEstimate.amount0.toString(), amount1: burnEstimate.amount1.toString() },
        swapAmount: swapAmount.toString(),
        mintLiquidity: mint.liquidity.toString(),
      },
    };
  } catch (e: any) {
    const errMsg = e.shortMessage || e.message;
    log(`ERROR: ${errMsg}`);
    return { success: false, tokenId: tokenIdStr, error: errMsg };
  }
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

  try {
    const owner = await getPositionOwner(tokenId, config);
    if (owner.toLowerCase() !== userEOA.toLowerCase()) {
      issues.push(`Position ${tokenId} owned by ${owner}, not ${userEOA}`);
    }
  } catch (e: any) {
    issues.push(`Cannot read position owner: ${e.message}`);
  }

  try {
    const registered = await isKeyRegistered(userEOA, agentAddress, config);
    if (!registered) {
      issues.push(`Agent key not registered on user's Calibur delegation`);
    }
  } catch (e: any) {
    issues.push(`Cannot check key registration: ${e.message}`);
  }

  if (poolWhitelist) {
    try {
      const status = await checkPositionStatus(tokenId, config);
      const v = poolWhitelist.validate(status.position.poolKey, `Position ${tokenId}`);
      if (!v.valid) issues.push(v.reason);
    } catch (e: any) {
      issues.push(`Cannot validate pool: ${e.message}`);
    }
  }

  return { ok: issues.length === 0, issues };
}
