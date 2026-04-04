/**
 * ALMA Agent Backend — Server for delegation relay + position monitoring + auto-rebalancing.
 *
 *   GET  /api/agent              — agent public address
 *   POST /api/delegate           — relay signed delegation via Calibur
 *   POST /api/users              — register user for monitoring
 *   POST /api/rebalance/:tokenId — trigger manual rebalance
 *   GET  /api/actions            — activity history (all or per-address)
 *   GET  /api/rebalances         — rebalance history (all or per-address)
 *   GET  /api/stats/:address     — per-user stats
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
import { discoverPositions } from './lib/position-discovery.js';
import {
  registerUser,
  getRegisteredUsers,
  getUserStats,
  updateUserStats,
  logActivity,
  getActivities,
  logRebalance,
  getRebalances,
  checkRedisConnection,
} from './lib/store.js';

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

// In-memory cache of user positions (refreshed each scan from subgraph)
const userPositions = new Map<string, string[]>();
const rebalancingInProgress = new Set<string>();

function ts(): string {
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

    const wrappedSignature = encodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes' }],
      [signature as Hex, '0x' as Hex]
    );

    const calldata = encodeFunctionData({
      abi: caliburAbi,
      functionName: 'execute',
      args: [parsedCall, wrappedSignature],
    });

    const txHash = await walletClient.sendTransaction({
      to: userAddress as Address,
      data: calldata,
      value: 0n,
      gas: 1_000_000n,
    });

    console.log(`[delegate] TX submitted: ${txHash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[delegate] Confirmed in block ${receipt.blockNumber}`);

    // Register user in Redis
    const userAddr = userAddress.toLowerCase();
    await registerUser(userAddr);

    await logActivity({
      type: 'delegation',
      status: 'completed',
      summary: `Delegation set up for ${userAddr.slice(0, 10)}...`,
      timestamp: Date.now(),
      owner: userAddr,
      txHashes: [txHash],
    });

    res.json({ ok: true, txHash });
  } catch (e: any) {
    console.error(`[delegate] Failed:`, e.shortMessage || e.message);
    res.status(500).json({ error: e.shortMessage || e.message });
  }
});

// POST /api/users — register user for monitoring
app.post('/api/users', async (req, res) => {
  const { address } = req.body as { address?: string };
  if (!address) { res.status(400).json({ error: 'address required' }); return; }

  const userAddr = address.toLowerCase();
  await registerUser(userAddr);

  await logActivity({
    type: 'registration',
    status: 'completed',
    summary: `User ${userAddr.slice(0, 10)}... registered for monitoring`,
    timestamp: Date.now(),
    owner: userAddr,
  });

  console.log(`[register] ${userAddr}`);
  res.json({ ok: true });
});

// POST /api/rebalance/:tokenId — trigger manual rebalance
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

    if (!decision.shouldRebalance) {
      res.json({ ok: true, action: 'none', reason: decision.reason });
      return;
    }

    let ownerAddress: Address;
    try {
      ownerAddress = await getPositionOwner(tokenId, config);
    } catch {
      res.status(400).json({ error: 'Cannot determine position owner.' });
      return;
    }

    rebalancingInProgress.add(tokenIdStr);

    await logActivity({
      type: 'rebalance',
      status: 'in_progress',
      summary: `Manual rebalance #${tokenIdStr}: ${decision.reason}`,
      timestamp: Date.now(),
      tokenId: tokenIdStr,
      owner: ownerAddress.toLowerCase(),
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

    await logRebalance({
      tokenId: tokenIdStr,
      owner: ownerAddress.toLowerCase(),
      timestamp: Date.now(),
      success: result.success,
      txHash: result.txHash,
      blockNumber: result.blockNumber?.toString(),
      newRange: result.newRange,
      error: result.error,
      details: result.details,
    });

    await logActivity({
      type: 'rebalance',
      status: result.success ? 'completed' : 'failed',
      summary: result.success
        ? `Rebalanced #${tokenIdStr} -> [${result.newRange?.tickLower}, ${result.newRange?.tickUpper}]`
        : `Rebalance #${tokenIdStr} failed: ${result.error}`,
      timestamp: Date.now(),
      tokenId: tokenIdStr,
      owner: ownerAddress.toLowerCase(),
      txHashes: result.txHash ? [result.txHash] : [],
    });

    const safeResult = JSON.parse(JSON.stringify(result, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    res.json({ ok: true, result: safeResult });
  } catch (e: any) {
    rebalancingInProgress.delete(tokenIdStr);
    console.error(`[rebalance] Error:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/actions — activity history
app.get('/api/actions', async (req, res) => {
  const address = req.query.address as string | undefined;
  const limit = parseInt(req.query.limit as string || '50');
  const activities = await getActivities(address, limit);
  res.json(activities);
});

// GET /api/rebalances — rebalance history
app.get('/api/rebalances', async (req, res) => {
  const address = req.query.address as string | undefined;
  const limit = parseInt(req.query.limit as string || '50');
  const records = await getRebalances(address, limit);
  res.json(records);
});

// GET /api/stats/:address — per-user stats
app.get('/api/stats/:address', async (req, res) => {
  const stats = await getUserStats(req.params.address);
  if (!stats) { res.status(404).json({ error: 'User not found' }); return; }
  res.json(stats);
});

// ---------------------------------------------------------------------------
// Monitoring Loop — runs every 60s
// ---------------------------------------------------------------------------

const MONITOR_INTERVAL = 60_000;
let scanCount = 0;

async function monitorPositions() {
  scanCount++;

  // Load registered users from Redis
  const registeredAddrs = await getRegisteredUsers();

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  MONITOR SCAN #${scanCount} | ${ts()}`);
  console.log(`  Users: ${registeredAddrs.length}`);
  console.log(`${'='.repeat(70)}`);

  if (registeredAddrs.length === 0) {
    console.log('  No users registered — waiting for delegations...');
    console.log(`${'='.repeat(70)}\n`);
    return;
  }

  // Auto-discover positions for all users via The Graph
  for (const addr of registeredAddrs) {
    try {
      const discovered = await discoverPositions(addr);
      const ids = discovered.map((p) => p.tokenId);
      const prev = userPositions.get(addr) || [];
      const prevSet = new Set(prev);
      const added = ids.filter((id) => !prevSet.has(id));
      if (added.length > 0) {
        console.log(`  [discover] ${addr}: +${added.length} new position(s): ${added.join(', ')}`);
      }
      userPositions.set(addr, ids);
      await updateUserStats(addr, { positionCount: ids.length, lastScanAt: Date.now() });
    } catch (e: any) {
      console.warn(`  [discover] ${addr}: error — ${e.message}`);
    }
  }

  const totalPositions = Array.from(userPositions.values()).reduce((s, p) => s + p.length, 0);
  console.log(`  Positions after discovery: ${totalPositions}`);

  for (const addr of registeredAddrs) {
    const positions = userPositions.get(addr) || [];
    console.log(`\n  User: ${addr} | Positions: ${positions.length}`);

    for (const tokenId of positions) {
      console.log(`\n  --- Position #${tokenId} ---`);

      try {
        const status = await checkPositionStatus(BigInt(tokenId), config);
        const { position, pool, isInRange, ticksOutOfRange, percentOutOfRange } = status;

        console.log(`  Pool: ${position.poolKey.currency0.slice(0, 10)}.../${position.poolKey.currency1.slice(0, 10)}...`);
        console.log(`    Fee: ${position.poolKey.fee} | Spacing: ${position.poolKey.tickSpacing}`);
        console.log(`  Range: [${position.tickLower}, ${position.tickUpper}] | Liquidity: ${position.liquidity}`);
        console.log(`  Pool tick: ${pool.tick} | sqrtPrice: ${pool.sqrtPriceX96}`);

        if (isInRange) {
          console.log(`  Status: IN RANGE`);
          await logActivity({
            type: 'monitor',
            status: 'completed',
            summary: `#${tokenId} in range (tick ${pool.tick} in [${position.tickLower}, ${position.tickUpper}])`,
            timestamp: Date.now(),
            tokenId,
            owner: addr,
          });
        } else {
          const dir = pool.tick < position.tickLower ? 'BELOW' : 'ABOVE';
          console.log(`  Status: OUT OF RANGE (${dir}) — ${ticksOutOfRange} ticks (${percentOutOfRange.toFixed(1)}%)`);

          const decision = await evaluateRebalance(BigInt(tokenId), config);

          if (decision.shouldRebalance) {
            console.log(`  -> REBALANCE TRIGGERED`);

            if (rebalancingInProgress.has(tokenId)) {
              console.log(`  -> Already in progress, skipping`);
              continue;
            }

            rebalancingInProgress.add(tokenId);

            await logActivity({
              type: 'rebalance',
              status: 'in_progress',
              summary: `Auto-rebalancing #${tokenId}: ${decision.reason}`,
              timestamp: Date.now(),
              tokenId,
              owner: addr,
            });

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

              // Persist rebalance record
              await logRebalance({
                tokenId,
                owner: addr,
                timestamp: Date.now(),
                success: result.success,
                txHash: result.txHash,
                blockNumber: result.blockNumber?.toString(),
                newRange: result.newRange,
                error: result.error,
                details: result.details,
              });

              if (result.success) {
                console.log(`  REBALANCE COMPLETE for #${tokenId}`);
                console.log(`    New range: [${result.newRange?.tickLower}, ${result.newRange?.tickUpper}]`);
                console.log(`    TX: ${result.txHash}`);

                await logActivity({
                  type: 'rebalance',
                  status: 'completed',
                  summary: `Rebalanced #${tokenId} -> [${result.newRange?.tickLower}, ${result.newRange?.tickUpper}]`,
                  timestamp: Date.now(),
                  tokenId,
                  owner: addr,
                  txHashes: result.txHash ? [result.txHash] : [],
                });
              } else {
                console.log(`  REBALANCE FAILED for #${tokenId}: ${result.error}`);

                await logActivity({
                  type: 'rebalance',
                  status: 'failed',
                  summary: `Rebalance #${tokenId} failed: ${result.error}`,
                  timestamp: Date.now(),
                  tokenId,
                  owner: addr,
                });
              }
            } catch (rebalErr: any) {
              rebalancingInProgress.delete(tokenId);
              console.error(`  REBALANCE ERROR for #${tokenId}: ${rebalErr.message}`);

              await logRebalance({
                tokenId,
                owner: addr,
                timestamp: Date.now(),
                success: false,
                error: rebalErr.message,
              });

              await logActivity({
                type: 'rebalance',
                status: 'failed',
                summary: `Rebalance #${tokenId} error: ${rebalErr.message}`,
                timestamp: Date.now(),
                tokenId,
                owner: addr,
              });
            }

            console.log(`  ${'~'.repeat(50)}\n`);
          } else {
            console.log(`  -> No rebalance needed: ${decision.reason}`);
            await logActivity({
              type: 'monitor',
              status: 'completed',
              summary: `#${tokenId} out of range but below threshold: ${decision.reason}`,
              timestamp: Date.now(),
              tokenId,
              owner: addr,
            });
          }
        }
      } catch (e: any) {
        console.error(`  ERROR reading position #${tokenId}: ${e.message}`);
        await logActivity({
          type: 'monitor',
          status: 'failed',
          summary: `Error monitoring #${tokenId}: ${e.message}`,
          timestamp: Date.now(),
          tokenId,
          owner: addr,
        });
      }
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  SCAN #${scanCount} COMPLETE | ${ts()}`);
  console.log(`  Next scan in ${MONITOR_INTERVAL / 1000}s`);
  console.log(`${'='.repeat(70)}\n`);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const server = app.listen(PORT, async () => {
  const redisOk = await checkRedisConnection();

  console.log(`\n${'='.repeat(50)}`);
  console.log(`  ALMA Agent Backend`);
  console.log(`${'='.repeat(50)}`);
  console.log(`  Agent:   ${agentAccount.address}`);
  console.log(`  Chain:   ${config.name} (${config.chainId})`);
  console.log(`  API:     http://localhost:${PORT}`);
  console.log(`  Monitor: every ${MONITOR_INTERVAL / 1000}s`);
  console.log(`  Redis:   ${redisOk ? 'connected' : 'FAILED'}`);
  console.log(`  Key Hash: ${computeKeyHash(agentAccount.address)}`);
  console.log(`${'='.repeat(50)}\n`);

  if (!redisOk) {
    console.error('Redis connection failed — data will not be persisted!');
  }

  monitorPositions();
  setInterval(monitorPositions, MONITOR_INTERVAL);
});

server.on('error', (err) => {
  console.error('Server error:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
