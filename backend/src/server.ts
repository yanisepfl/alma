/**
 * ALMA Agent Backend — Server for delegation relay + position monitoring + auto-rebalancing.
 *
 *   GET  /api/agent     — agent public address
 *   POST /api/delegate  — relay signed delegation via Calibur execute(SignedBatchedCall)
 *   GET  /api/actions   — agent action history
 *   POST /api/users     — register user for monitoring
 *   POST /api/rebalance/:tokenId — trigger manual rebalance
 *
 * Run: npx tsx src/server.ts
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import {
  type Address,
  type Hex,
  encodeFunctionData,
  encodeAbiParameters,
} from 'viem';

import { getConfig, type ChainConfig } from './lib/config.js';
import { getPublicClient, getWalletClient } from './lib/client.js';
import { caliburAbi } from './abis/calibur.js';
import { evaluateRebalance, executeRebalance } from './lib/rebalancer.js';
import { checkPositionStatus, getPositionOwner } from './lib/position-monitor.js';
import { computeKeyHash } from './lib/calibur.js';
import { UniswapApiClient } from './lib/uniswap-api.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || '3001');
const AGENT_PK = process.env.AGENT_PRIVATE_KEY as `0x${string}`;

if (!AGENT_PK) {
  console.error('AGENT_PRIVATE_KEY is required in .env');
  process.exit(1);
}

const agentAccount: PrivateKeyAccount = privateKeyToAccount(AGENT_PK);
const config: ChainConfig = getConfig();
const publicClient = getPublicClient(config);
const { walletClient } = getWalletClient(config, AGENT_PK);
const uniswapApi = new UniswapApiClient();

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

interface MonitoredUser {
  address: Address;
  positions: string[];
  registeredAt: number;
}

interface Action {
  type: string;
  status: string;
  summary: string;
  timestamp: number;
  tokenId?: string;
  owner?: string;
  txHashes?: string[];
}

const users = new Map<string, MonitoredUser>();
const actions: Action[] = [];
const MAX_ACTIONS = 200;

// Track positions currently being rebalanced to avoid double-triggering
const rebalancingInProgress = new Set<string>();

function trackAction(a: Omit<Action, 'timestamp'>) {
  actions.unshift({ ...a, timestamp: Date.now() });
  if (actions.length > MAX_ACTIONS) actions.pop();
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ---------------------------------------------------------------------------
// Express App
// ---------------------------------------------------------------------------

const app = express();
app.use(cors());
app.use(express.json());

// GET /api/agent
app.get('/api/agent', (_req, res) => {
  res.json({
    address: agentAccount.address,
    chain: config.name,
    chainId: config.chainId,
  });
});

// POST /api/delegate — relay a signed Calibur delegation
app.post('/api/delegate', async (req, res) => {
  const { userAddress, signedBatchedCall, signature, positions } = req.body;

  if (!userAddress || !signedBatchedCall || !signature) {
    res.status(400).json({ error: 'userAddress, signedBatchedCall, and signature are required' });
    return;
  }

  try {
    console.log(`[delegate] Relaying SignedBatchedCall for ${userAddress}`);
    console.log(`[delegate] Raw signedBatchedCall:`, JSON.stringify(signedBatchedCall, null, 2));

    const parsedCall = {
      batchedCall: {
        calls: signedBatchedCall.batchedCall.calls.map((c: any) => ({
          to: c.to as Address,
          value: BigInt(c.value),
          data: c.data as Hex,
        })),
        revertOnFailure: signedBatchedCall.batchedCall.revertOnFailure,
      },
      nonce: BigInt(signedBatchedCall.nonce),
      keyHash: signedBatchedCall.keyHash as Hex,
      executor: signedBatchedCall.executor as Address,
      deadline: BigInt(signedBatchedCall.deadline),
    };

    console.log(`[delegate] Parsed nonce: ${parsedCall.nonce}`);
    console.log(`[delegate] Calls count: ${parsedCall.batchedCall.calls.length}`);

    const wrappedSignature = encodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes' }],
      [signature as Hex, '0x' as Hex]
    );

    const calldata = encodeFunctionData({
      abi: caliburAbi,
      functionName: 'execute',
      args: [parsedCall, wrappedSignature],
    });

    console.log(`[delegate] Calldata length: ${calldata.length}`);

    const txHash = await walletClient.sendTransaction({
      to: userAddress as Address,
      data: calldata,
      value: 0n,
      gas: 500_000n,
    });

    console.log(`[delegate] TX submitted: ${txHash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[delegate] Confirmed in block ${receipt.blockNumber}`);

    // Register user for monitoring
    const userAddr = userAddress.toLowerCase() as Address;
    users.set(userAddr, {
      address: userAddr,
      positions: positions ?? [],
      registeredAt: Date.now(),
    });

    trackAction({
      type: 'delegation',
      status: 'completed',
      summary: `Delegation set up for ${userAddr.slice(0, 8)}...`,
      owner: userAddr,
    });

    res.json({ ok: true, txHash });
  } catch (e: any) {
    console.error(`[delegate] Failed:`, e.shortMessage || e.message);
    res.status(500).json({ error: e.shortMessage || e.message });
  }
});

// POST /api/users — register user for monitoring
app.post('/api/users', async (req, res) => {
  const { address, positions } = req.body as { address?: string; positions?: string[] };
  if (!address) { res.status(400).json({ error: 'address required' }); return; }

  const userAddr = address.toLowerCase() as Address;
  users.set(userAddr, {
    address: userAddr,
    positions: positions ?? [],
    registeredAt: Date.now(),
  });

  console.log(`[register] ${userAddr} — ${positions?.length || 0} positions`);
  res.json({ ok: true });
});

// POST /api/rebalance/:tokenId — trigger manual rebalance check + execution
app.post('/api/rebalance/:tokenId', async (req, res) => {
  const tokenId = BigInt(req.params.tokenId);
  const tokenIdStr = tokenId.toString();
  console.log(`\n[rebalance] Manual trigger for position #${tokenIdStr}`);

  if (rebalancingInProgress.has(tokenIdStr)) {
    res.status(409).json({ error: 'Rebalance already in progress for this position' });
    return;
  }

  try {
    const decision = await evaluateRebalance(tokenId, config);
    console.log(`[rebalance] Decision: ${decision.reason}`);

    if (!decision.shouldRebalance) {
      trackAction({
        type: 'monitor',
        status: 'completed',
        summary: `Position #${tokenIdStr}: ${decision.reason}`,
        tokenId: tokenIdStr,
      });
      res.json({ ok: true, action: 'none', reason: decision.reason });
      return;
    }

    // Find the user who owns this position
    let ownerAddress: Address | undefined;
    for (const [addr, user] of users) {
      if (user.positions.includes(tokenIdStr)) {
        ownerAddress = addr as Address;
        break;
      }
    }

    if (!ownerAddress) {
      // Try to read owner from chain
      try {
        ownerAddress = await getPositionOwner(tokenId, config);
      } catch {
        res.status(400).json({ error: 'Cannot determine position owner. Register the user first.' });
        return;
      }
    }

    // Execute the rebalance
    rebalancingInProgress.add(tokenIdStr);
    trackAction({
      type: 'rebalance',
      status: 'in_progress',
      summary: `Rebalancing #${tokenIdStr}: ${decision.reason}`,
      tokenId: tokenIdStr,
      owner: ownerAddress,
    });

    const result = await executeRebalance({
      tokenId,
      userEOA: ownerAddress,
      decision,
      config,
      agentAccount,
      walletClient,
      publicClient,
      uniswapApi,
    });

    rebalancingInProgress.delete(tokenIdStr);

    trackAction({
      type: 'rebalance',
      status: result.success ? 'completed' : 'failed',
      summary: result.success
        ? `Rebalanced #${tokenIdStr} -> range [${result.newRange?.tickLower}, ${result.newRange?.tickUpper}]`
        : `Rebalance #${tokenIdStr} failed: ${result.error}`,
      tokenId: tokenIdStr,
      owner: ownerAddress,
      txHashes: result.txHash ? [result.txHash] : [],
    });

    // Serialize BigInts for JSON response
    const safeResult = JSON.parse(JSON.stringify(result, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    res.json({ ok: true, result: safeResult });
  } catch (e: any) {
    rebalancingInProgress.delete(tokenIdStr);
    console.error(`[rebalance] Error:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/actions — action history
app.get('/api/actions', (_req, res) => {
  res.json(actions);
});

// ---------------------------------------------------------------------------
// Monitoring Loop — runs every 60s
// ---------------------------------------------------------------------------

const MONITOR_INTERVAL = 60_000; // 60s
let scanCount = 0;

async function monitorPositions() {
  scanCount++;
  const totalPositions = Array.from(users.values()).reduce((sum, u) => sum + u.positions.length, 0);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  MONITOR SCAN #${scanCount} | ${timestamp()}`);
  console.log(`  Users: ${users.size} | Positions: ${totalPositions}`);
  console.log(`${'='.repeat(70)}`);

  if (users.size === 0) {
    console.log('  No users registered — waiting for delegations...');
    console.log(`${'='.repeat(70)}\n`);
    return;
  }

  for (const [addr, user] of users) {
    console.log(`\n  User: ${addr}`);
    console.log(`  Registered: ${new Date(user.registeredAt).toISOString()}`);
    console.log(`  Positions: ${user.positions.length}`);

    for (const tokenId of user.positions) {
      console.log(`\n  --- Position #${tokenId} ---`);

      try {
        // Read full position status from chain
        const status = await checkPositionStatus(BigInt(tokenId), config);
        const { position, pool, isInRange, ticksOutOfRange, percentOutOfRange } = status;

        // Log detailed position info
        console.log(`  Pool: ${position.poolKey.currency0.slice(0, 10)}.../${position.poolKey.currency1.slice(0, 10)}...`);
        console.log(`    Fee: ${position.poolKey.fee} | Tick Spacing: ${position.poolKey.tickSpacing}`);
        console.log(`    Hooks: ${position.poolKey.hooks}`);
        console.log(`  Position Range: [${position.tickLower}, ${position.tickUpper}]`);
        console.log(`  Liquidity: ${position.liquidity.toString()}`);
        console.log(`  Pool State:`);
        console.log(`    Current Tick: ${pool.tick}`);
        console.log(`    sqrtPriceX96: ${pool.sqrtPriceX96.toString()}`);
        console.log(`    Pool Liquidity: ${pool.liquidity.toString()}`);

        if (isInRange) {
          const distToLower = pool.tick - position.tickLower;
          const distToUpper = position.tickUpper - pool.tick;
          console.log(`  Status: IN RANGE`);
          console.log(`    Distance to lower: ${distToLower} ticks | Distance to upper: ${distToUpper} ticks`);

          trackAction({
            type: 'monitor',
            status: 'completed',
            summary: `#${tokenId} in range (tick ${pool.tick} in [${position.tickLower}, ${position.tickUpper}])`,
            tokenId,
            owner: addr,
          });
        } else {
          const direction = pool.tick < position.tickLower ? 'BELOW' : 'ABOVE';
          console.log(`  Status: OUT OF RANGE (${direction})`);
          console.log(`    ${ticksOutOfRange} ticks out (${percentOutOfRange.toFixed(1)}%)`);

          // Evaluate rebalance decision
          const decision = await evaluateRebalance(BigInt(tokenId), config);

          if (decision.shouldRebalance) {
            console.log(`  -> REBALANCE TRIGGERED: ${decision.reason}`);

            // Check if already rebalancing
            if (rebalancingInProgress.has(tokenId)) {
              console.log(`  -> Rebalance already in progress, skipping`);
              continue;
            }

            trackAction({
              type: 'rebalance',
              status: 'in_progress',
              summary: `Auto-rebalancing #${tokenId}: ${decision.reason}`,
              tokenId,
              owner: addr,
            });

            // Execute rebalance
            rebalancingInProgress.add(tokenId);

            console.log(`\n  ${'~'.repeat(50)}`);
            console.log(`  EXECUTING REBALANCE for #${tokenId}`);
            console.log(`  ${'~'.repeat(50)}`);

            try {
              const result = await executeRebalance({
                tokenId: BigInt(tokenId),
                userEOA: addr as Address,
                decision,
                config,
                agentAccount,
                walletClient,
                publicClient,
                uniswapApi,
              });

              rebalancingInProgress.delete(tokenId);

              if (result.success) {
                console.log(`  REBALANCE COMPLETE for #${tokenId}`);
                console.log(`    New range: [${result.newRange?.tickLower}, ${result.newRange?.tickUpper}]`);
                console.log(`    TX: ${result.txHash}`);

                trackAction({
                  type: 'rebalance',
                  status: 'completed',
                  summary: `Rebalanced #${tokenId} -> [${result.newRange?.tickLower}, ${result.newRange?.tickUpper}]`,
                  tokenId,
                  owner: addr,
                  txHashes: result.txHash ? [result.txHash] : [],
                });
              } else {
                console.log(`  REBALANCE FAILED for #${tokenId}: ${result.error}`);

                trackAction({
                  type: 'rebalance',
                  status: 'failed',
                  summary: `Rebalance #${tokenId} failed: ${result.error}`,
                  tokenId,
                  owner: addr,
                });
              }
            } catch (rebalErr: any) {
              rebalancingInProgress.delete(tokenId);
              console.error(`  REBALANCE ERROR for #${tokenId}: ${rebalErr.message}`);

              trackAction({
                type: 'rebalance',
                status: 'failed',
                summary: `Rebalance #${tokenId} error: ${rebalErr.message}`,
                tokenId,
                owner: addr,
              });
            }

            console.log(`  ${'~'.repeat(50)}\n`);
          } else {
            console.log(`  -> No rebalance needed: ${decision.reason}`);
            trackAction({
              type: 'monitor',
              status: 'completed',
              summary: `#${tokenId} out of range but below threshold: ${decision.reason}`,
              tokenId,
              owner: addr,
            });
          }
        }
      } catch (e: any) {
        console.error(`  ERROR reading position #${tokenId}: ${e.message}`);
        trackAction({
          type: 'monitor',
          status: 'failed',
          summary: `Error monitoring #${tokenId}: ${e.message}`,
          tokenId,
          owner: addr,
        });
      }
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  SCAN #${scanCount} COMPLETE | ${timestamp()}`);
  console.log(`  Next scan in ${MONITOR_INTERVAL / 1000}s`);
  console.log(`${'='.repeat(70)}\n`);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const server = app.listen(PORT, () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  ALMA Agent Backend`);
  console.log(`${'='.repeat(50)}`);
  console.log(`  Agent:   ${agentAccount.address}`);
  console.log(`  Chain:   ${config.name} (${config.chainId})`);
  console.log(`  API:     http://localhost:${PORT}`);
  console.log(`  Monitor: every ${MONITOR_INTERVAL / 1000}s`);
  console.log(`  Key Hash: ${computeKeyHash(agentAccount.address)}`);
  console.log(`${'='.repeat(50)}\n`);

  // Run first scan immediately, then every MONITOR_INTERVAL
  monitorPositions();
  setInterval(monitorPositions, MONITOR_INTERVAL);
});

server.on('error', (err) => {
  console.error('Server error:', err);
});

// Keep process alive
process.on('uncaughtException', (err) => {
  console.error('Uncaught:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
