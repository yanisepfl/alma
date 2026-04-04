/**
 * ALMA Agent Backend — Minimal server for delegation relay + monitoring.
 *
 *   GET  /api/agent     — agent public address
 *   POST /api/delegate  — relay signed delegation via Calibur execute(SignedBatchedCall)
 *   GET  /api/actions   — agent action history
 *   POST /api/users     — register user for monitoring
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
import { evaluateRebalance } from './lib/rebalancer.js';
import { checkPositionStatus, getPositionOwner } from './lib/position-monitor.js';
import { buildSignedBatchedCall, submitBatchedCall, computeKeyHash } from './lib/calibur.js';
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

function trackAction(a: Omit<Action, 'timestamp'>) {
  actions.unshift({ ...a, timestamp: Date.now() });
  if (actions.length > MAX_ACTIONS) actions.pop();
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
// Frontend sends: { userAddress, signedBatchedCall, signature, positions }
// Backend calls execute(SignedBatchedCall, wrappedSignature) on user's EOA
app.post('/api/delegate', async (req, res) => {
  const { userAddress, signedBatchedCall, signature, positions } = req.body;

  if (!userAddress || !signedBatchedCall || !signature) {
    res.status(400).json({ error: 'userAddress, signedBatchedCall, and signature are required' });
    return;
  }

  try {
    console.log(`[delegate] Relaying SignedBatchedCall for ${userAddress}`);
    console.log(`[delegate] Raw signedBatchedCall:`, JSON.stringify(signedBatchedCall, null, 2));

    // Convert all numeric string fields to BigInt for proper ABI encoding
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

    // Wrap the raw signature as abi.encode(bytes signature, bytes hookData)
    // Calibur's WrappedSignatureLib.decodeWithHookData expects this format
    const wrappedSignature = encodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes' }],
      [signature as Hex, '0x' as Hex]
    );

    // Encode the execute(SignedBatchedCall, bytes) call
    const calldata = encodeFunctionData({
      abi: caliburAbi,
      functionName: 'execute',
      args: [parsedCall, wrappedSignature],
    });

    console.log(`[delegate] Calldata length: ${calldata.length}`);

    // Skip simulation — eth_call may not resolve EIP-7702 delegation properly
    // Send tx directly from agent wallet to user's EOA (which has Calibur code)
    // Set manual gas to skip eth_estimateGas (which simulates and may fail on 7702 delegation)
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

// POST /api/rebalance/:tokenId — trigger manual rebalance check
app.post('/api/rebalance/:tokenId', async (req, res) => {
  const tokenId = BigInt(req.params.tokenId);
  console.log(`[rebalance] Manual trigger for position #${tokenId}`);

  try {
    const decision = await evaluateRebalance(tokenId, config);
    console.log(`[rebalance] Decision: ${decision.reason}`);

    trackAction({
      type: 'monitor',
      status: decision.shouldRebalance ? 'evaluating' : 'completed',
      summary: decision.shouldRebalance
        ? `Position #${tokenId} needs rebalance: ${decision.reason}`
        : `Position #${tokenId}: ${decision.reason}`,
      tokenId: tokenId.toString(),
    });

    if (!decision.shouldRebalance) {
      res.json({ ok: true, action: 'none', reason: decision.reason });
      return;
    }

    // For now, just log that rebalance is needed
    // Full execution (burn → swap → mint via Calibur) requires calldata-builders
    // which is a TODO for production
    res.json({
      ok: true,
      action: 'rebalance_needed',
      reason: decision.reason,
      status: {
        currentTick: decision.status.pool.tick,
        tickLower: decision.status.position.tickLower,
        tickUpper: decision.status.position.tickUpper,
        percentOutOfRange: decision.status.percentOutOfRange,
      },
    });
  } catch (e: any) {
    console.error(`[rebalance] Error:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/actions — action history
app.get('/api/actions', (_req, res) => {
  res.json(actions);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Monitoring Loop
// ---------------------------------------------------------------------------

const MONITOR_INTERVAL = 60_000; // 60s

async function monitorPositions() {
  if (users.size === 0) return;
  console.log(`\n[monitor] Checking ${users.size} user(s)...`);

  for (const [addr, user] of users) {
    for (const tokenId of user.positions) {
      try {
        const decision = await evaluateRebalance(BigInt(tokenId), config);

        if (decision.shouldRebalance) {
          console.log(`[monitor] ${addr} #${tokenId} — NEEDS REBALANCE: ${decision.reason}`);
          trackAction({
            type: 'monitor',
            status: 'evaluating',
            summary: `Position #${tokenId} out of range — ${decision.reason}`,
            tokenId,
            owner: addr,
          });
        } else {
          console.log(`[monitor] ${addr} #${tokenId} — OK: ${decision.reason}`);
          trackAction({
            type: 'monitor',
            status: 'completed',
            summary: `Checked #${tokenId} — ${decision.reason}`,
            tokenId,
            owner: addr,
          });
        }
      } catch (e: any) {
        console.warn(`[monitor] ${addr} #${tokenId} — error: ${e.message}`);
      }
    }
  }
}

const server = app.listen(PORT, () => {
  console.log(`\n═══ ALMA Agent Backend ═══`);
  console.log(`  Agent:   ${agentAccount.address}`);
  console.log(`  Chain:   ${config.name} (${config.chainId})`);
  console.log(`  API:     http://localhost:${PORT}`);
  console.log(`  Monitor: every ${MONITOR_INTERVAL / 1000}s`);
  console.log(`═══════════════════════════\n`);

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
