/**
 * Calibur ABI — subset needed for the agent.
 *
 * Structs (from Calibur source):
 *   Call { address to, uint256 value, bytes data }
 *   BatchedCall { Call[] calls, bool revertOnFailure }
 *   SignedBatchedCall { BatchedCall batchedCall, uint256 nonce, bytes32 keyHash, address executor, uint256 deadline }
 */

const CallComponents = [
  { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'data', type: 'bytes' },
] as const;

const BatchedCallComponents = [
  { name: 'calls', type: 'tuple[]', components: CallComponents },
  { name: 'revertOnFailure', type: 'bool' },
] as const;

const SignedBatchedCallComponents = [
  { name: 'batchedCall', type: 'tuple', components: BatchedCallComponents },
  { name: 'nonce', type: 'uint256' },
  { name: 'keyHash', type: 'bytes32' },
  { name: 'executor', type: 'address' },
  { name: 'deadline', type: 'uint256' },
] as const;

export const caliburAbi = [
  // ── Execute (agent submits signed batched calls) ──────────────────────
  {
    name: 'execute',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'signedBatchedCall', type: 'tuple', components: SignedBatchedCallComponents },
      { name: 'wrappedSignature', type: 'bytes' },
    ],
    outputs: [],
  },

  // ── Execute (direct, by owner) ────────────────────────────────────────
  {
    name: 'execute',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'batchedCall', type: 'tuple', components: BatchedCallComponents },
    ],
    outputs: [],
  },

  // ── Key management ────────────────────────────────────────────────────
  {
    name: 'register',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'key',
        type: 'tuple',
        components: [
          { name: 'keyType', type: 'uint8' },
          { name: 'publicKey', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: 'keyHash', type: 'bytes32' }],
  },
  {
    name: 'revoke',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'keyHash', type: 'bytes32' }],
    outputs: [],
  },

  // ── Read state ────────────────────────────────────────────────────────
  {
    name: 'getSeq',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'key', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'isRegistered',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'keyHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'eip712Domain',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'fields', type: 'bytes1' },
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
      { name: 'salt', type: 'bytes32' },
      { name: 'extensions', type: 'uint256[]' },
    ],
  },
] as const;

// EIP-712 typed data for SignedBatchedCall
// Type string: "SignedBatchedCall(BatchedCall batchedCall,uint256 nonce,bytes32 keyHash,address executor,uint256 deadline)BatchedCall(Call[] calls,bool revertOnFailure)Call(address to,uint256 value,bytes data)"
export const CALIBUR_SIGNED_BATCHED_CALL_TYPES = {
  SignedBatchedCall: [
    { name: 'batchedCall', type: 'BatchedCall' },
    { name: 'nonce', type: 'uint256' },
    { name: 'keyHash', type: 'bytes32' },
    { name: 'executor', type: 'address' },
    { name: 'deadline', type: 'uint256' },
  ],
  BatchedCall: [
    { name: 'calls', type: 'Call[]' },
    { name: 'revertOnFailure', type: 'bool' },
  ],
  Call: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
} as const;
