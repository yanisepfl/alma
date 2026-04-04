/**
 * Calibur Integration — SignedBatchedCall construction & submission.
 *
 * The agent signs a batch of calls (burn + swap + mint) using its registered key,
 * then submits via Calibur's execute(SignedBatchedCall, wrappedSignature).
 * Calibur validates the key and executes each call AS the user's delegated EOA.
 */

import {
  type Address,
  type Hex,
  type Account,
  type WalletClient,
  type PublicClient,
  encodeFunctionData,
  encodeAbiParameters,
  keccak256,
  concat,
  pad,
  toHex,
} from 'viem';
import { caliburAbi, CALIBUR_SIGNED_BATCHED_CALL_TYPES } from '../abis/calibur.js';
import { type ChainConfig } from './config.js';
import { getPublicClient } from './client.js';
import { buildWhitelist, validateCalls, type AllowedCall } from './call-validator.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CaliburCall {
  to: Address;
  value: bigint;
  data: Hex;
}

export interface SignedBatchedCall {
  batchedCall: {
    calls: CaliburCall[];
    revertOnFailure: boolean;
  };
  nonce: bigint;
  keyHash: Hex;
  executor: Address;
  deadline: bigint;
}

// ---------------------------------------------------------------------------
// Compute key hash for a Secp256k1 agent address
// ---------------------------------------------------------------------------

/**
 * Compute the Calibur key hash for a Secp256k1 agent address.
 *
 * Calibur's KeyLib.hash(): keccak256(abi.encode(keyType, keccak256(publicKey)))
 * Enum: P256=0, WebAuthnP256=1, Secp256k1=2
 */
export function computeKeyHash(agentAddress: Address): Hex {
  const SECP256K1_KEY_TYPE = 2;
  const publicKeyEncoded = encodeAbiParameters([{ type: 'address' }], [agentAddress]);
  const innerHash = keccak256(publicKeyEncoded);
  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint8' }, { type: 'bytes32' }],
      [SECP256K1_KEY_TYPE, innerHash]
    )
  );
}

// ---------------------------------------------------------------------------
// Read current nonce from user's Calibur-delegated EOA
// ---------------------------------------------------------------------------

/**
 * Read the current nonce from user's Calibur-delegated EOA.
 * Calibur uses NonceManager: mapping(uint256 key => uint256 seq).
 * Key 0 is the default sequence used by SignedBatchedCall.
 * The nonce in SignedBatchedCall is encoded as (key << 64 | seq).
 */
export async function getCaliburNonce(
  userEOA: Address,
  config: ChainConfig,
  nonceKey: bigint = 0n
): Promise<bigint> {
  const client = getPublicClient(config);
  const seq = await client.readContract({
    address: userEOA,
    abi: caliburAbi,
    functionName: 'getSeq',
    args: [nonceKey],
  }) as bigint;
  // Nonce format: (key << 64) | seq
  return (nonceKey << 64n) | seq;
}

// ---------------------------------------------------------------------------
// Check if agent key is registered
// ---------------------------------------------------------------------------

export async function isKeyRegistered(
  userEOA: Address,
  agentAddress: Address,
  config: ChainConfig
): Promise<boolean> {
  const client = getPublicClient(config);
  const keyHash = computeKeyHash(agentAddress);
  const result = await client.readContract({
    address: userEOA,
    abi: caliburAbi,
    functionName: 'isRegistered',
    args: [keyHash],
  });
  return result as boolean;
}

// ---------------------------------------------------------------------------
// Get key settings (expiry, hook)
// ---------------------------------------------------------------------------

export async function getKeySettings(
  userEOA: Address,
  agentAddress: Address,
  config: ChainConfig
): Promise<{ expiry: bigint; hook: Address }> {
  const client = getPublicClient(config);
  const keyHash = computeKeyHash(agentAddress);
  const result = await client.readContract({
    address: userEOA,
    abi: caliburAbi,
    functionName: 'getKeySettings',
    args: [keyHash],
  });
  const { expiry, hook } = result as { expiry: bigint; hook: Address };
  return { expiry, hook };
}

// ---------------------------------------------------------------------------
// Construct and sign a SignedBatchedCall
// ---------------------------------------------------------------------------

export async function buildSignedBatchedCall(params: {
  userEOA: Address;
  agentAccount: Account;
  calls: CaliburCall[];
  config: ChainConfig;
  deadlineSeconds?: number;
  /** Override nonce (for testing or when pre-fetched). If omitted, reads from chain. */
  nonce?: bigint;
  /** Extra token addresses to allow approve() calls for. */
  allowedTokens?: Address[];
  /** Skip call validation (for testing only). */
  skipValidation?: boolean;
}): Promise<{ signedCall: SignedBatchedCall; wrappedSignature: Hex }> {
  const { userEOA, agentAccount, calls, config, deadlineSeconds = 300 } = params;

  // 0. SECURITY: Validate all calls against whitelist before signing
  if (!params.skipValidation) {
    const whitelist = buildWhitelist(config, params.allowedTokens);
    const validation = validateCalls(calls, whitelist, config);
    if (!validation.valid) {
      throw new Error(`SECURITY: Refused to sign batch — ${validation.reason}`);
    }
  }

  // 1. Get current nonce from user's delegated EOA (or use override)
  const nonce = params.nonce ?? await getCaliburNonce(userEOA, config);

  // 2. Build the SignedBatchedCall struct
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);
  const keyHash = computeKeyHash(agentAccount.address);

  const signedCall: SignedBatchedCall = {
    batchedCall: {
      calls,
      revertOnFailure: true,
    },
    nonce,
    keyHash,
    executor: agentAccount.address,
    deadline,
  };

  // 3. Sign the EIP-712 typed data with the agent's key
  // Domain: name=Calibur, version=1.0.0, chainId, verifyingContract=user's EOA, salt=padded Calibur impl address
  const CALIBUR_IMPL = config.contracts.calibur.toLowerCase().replace('0x', '');
  const salt = `0x000000000000000000000000${CALIBUR_IMPL}` as `0x${string}`;

  const signature = await agentAccount.signTypedData({
    domain: {
      name: 'Calibur',
      version: '1.0.0',
      verifyingContract: userEOA,
      chainId: config.chainId,
      salt,
    },
    types: CALIBUR_SIGNED_BATCHED_CALL_TYPES,
    primaryType: 'SignedBatchedCall',
    message: {
      batchedCall: {
        calls: calls.map((c) => ({
          to: c.to,
          value: c.value,
          data: c.data,
        })),
        revertOnFailure: true,
      },
      nonce,
      keyHash,
      executor: agentAccount.address,
      deadline,
    },
  });

  // 4. Wrap signature as (signature, hookData) — keyHash is already in the SignedBatchedCall struct
  const hookData = '0x' as Hex; // no hook data for basic key
  const wrappedSignature = encodeAbiParameters(
    [
      { name: 'signature', type: 'bytes' },
      { name: 'hookData', type: 'bytes' },
    ],
    [signature, hookData]
  );

  return { signedCall, wrappedSignature };
}

// ---------------------------------------------------------------------------
// Submit the signed batch to the user's delegated EOA
// ---------------------------------------------------------------------------

export async function submitBatchedCall(params: {
  userEOA: Address;
  signedCall: SignedBatchedCall;
  wrappedSignature: Hex;
  walletClient: WalletClient;
  config: ChainConfig;
}): Promise<Hex> {
  const { userEOA, signedCall, wrappedSignature, walletClient, config } = params;

  // Encode the execute(SignedBatchedCall, wrappedSignature) call
  const calldata = encodeFunctionData({
    abi: caliburAbi,
    functionName: 'execute',
    args: [signedCall, wrappedSignature],
  });

  // Send the transaction TO the user's delegated EOA
  // (Calibur code is loaded there via 7702)
  // Set manual gas to skip eth_estimateGas which may fail on 7702 delegated EOAs
  const txHash = await walletClient.sendTransaction({
    to: userEOA,
    data: calldata,
    value: 0n,
    gas: 800_000n,
    chain: config.chain,
  });

  return txHash;
}
