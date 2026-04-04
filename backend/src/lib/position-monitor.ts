/**
 * Position Monitor — reads on-chain position & pool state.
 *
 * Ported from Alphix frontend's liquidity-utils.ts (pure RPC, no browser deps).
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  getAddress,
  encodeAbiParameters,
  keccak256,
} from 'viem';
import { positionManagerAbi, stateViewAbi } from '../abis/position-manager.js';
import { type ChainConfig } from './config.js';
import { getPublicClient } from './client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PositionInfo {
  tokenId: bigint;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  poolKey: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  };
}

export interface PoolState {
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
}

export interface PositionStatus {
  position: PositionInfo;
  pool: PoolState;
  poolId: Hex;
  isInRange: boolean;
  /** Positive = above range (price moved up), negative = below range (price moved down) */
  ticksOutOfRange: number;
  /** Percentage the current tick is outside the position range */
  percentOutOfRange: number;
}

// ---------------------------------------------------------------------------
// Decode packed position info (identical to frontend's decodePositionInfo)
// ---------------------------------------------------------------------------

function decodePositionInfo(value: bigint): { tickLower: number; tickUpper: number } {
  const toSigned24 = (raw: number): number => (raw >= 0x800000 ? raw - 0x1000000 : raw);
  const rawLower = Number((value >> 8n) & 0xFFFFFFn);
  const rawUpper = Number((value >> 32n) & 0xFFFFFFn);
  return {
    tickLower: toSigned24(rawLower),
    tickUpper: toSigned24(rawUpper),
  };
}

// ---------------------------------------------------------------------------
// Compute pool ID from pool key (keccak256 of ABI-encoded PoolKey struct)
// ---------------------------------------------------------------------------

export function computePoolId(poolKey: PositionInfo['poolKey']): Hex {
  const encoded = encodeAbiParameters(
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
    ],
    [
      {
        currency0: getAddress(poolKey.currency0),
        currency1: getAddress(poolKey.currency1),
        fee: poolKey.fee,
        tickSpacing: poolKey.tickSpacing,
        hooks: getAddress(poolKey.hooks),
      },
    ]
  );
  return keccak256(encoded);
}

// ---------------------------------------------------------------------------
// Fetch position details from on-chain
// ---------------------------------------------------------------------------

export async function getPositionDetails(
  tokenId: bigint,
  config: ChainConfig
): Promise<PositionInfo> {
  const client = getPublicClient(config);
  const pmAddress = config.contracts.positionManager;

  const [poolAndPositionResult, liquidityResult] = await client.multicall({
    contracts: [
      {
        address: pmAddress,
        abi: positionManagerAbi,
        functionName: 'getPoolAndPositionInfo',
        args: [tokenId],
      },
      {
        address: pmAddress,
        abi: positionManagerAbi,
        functionName: 'getPositionLiquidity',
        args: [tokenId],
      },
    ],
    allowFailure: false,
  });

  const [poolKey, infoValue] = poolAndPositionResult as [
    {
      currency0: Address;
      currency1: Address;
      fee: number;
      tickSpacing: number;
      hooks: Address;
    },
    bigint,
  ];
  const liquidity = liquidityResult as bigint;
  const decoded = decodePositionInfo(infoValue);

  return {
    tokenId,
    tickLower: decoded.tickLower,
    tickUpper: decoded.tickUpper,
    liquidity,
    poolKey,
  };
}

// ---------------------------------------------------------------------------
// Fetch pool state (slot0 + liquidity) from StateView
// ---------------------------------------------------------------------------

export async function getPoolState(
  poolId: Hex,
  config: ChainConfig
): Promise<PoolState> {
  const client = getPublicClient(config);
  const stateViewAddr = config.contracts.stateView;

  const [slot0Result, liquidityResult] = await client.multicall({
    contracts: [
      {
        address: stateViewAddr,
        abi: stateViewAbi,
        functionName: 'getSlot0',
        args: [poolId],
      },
      {
        address: stateViewAddr,
        abi: stateViewAbi,
        functionName: 'getLiquidity',
        args: [poolId],
      },
    ],
    allowFailure: false,
  });

  const slot0 = slot0Result as readonly [bigint, number, number, number];
  const poolLiquidity = liquidityResult as bigint;

  return {
    sqrtPriceX96: slot0[0],
    tick: Number(slot0[1]),
    liquidity: poolLiquidity,
  };
}

// ---------------------------------------------------------------------------
// Check if a position is in range, with details
// ---------------------------------------------------------------------------

export async function checkPositionStatus(
  tokenId: bigint,
  config: ChainConfig
): Promise<PositionStatus> {
  const position = await getPositionDetails(tokenId, config);
  const poolId = computePoolId(position.poolKey);
  const pool = await getPoolState(poolId, config);

  const currentTick = pool.tick;
  const isInRange = currentTick >= position.tickLower && currentTick <= position.tickUpper;

  let ticksOutOfRange = 0;
  if (currentTick < position.tickLower) {
    ticksOutOfRange = position.tickLower - currentTick; // positive = below range
  } else if (currentTick > position.tickUpper) {
    ticksOutOfRange = currentTick - position.tickUpper; // positive = above range
  }

  const rangeWidth = position.tickUpper - position.tickLower;
  const percentOutOfRange = rangeWidth > 0 ? (ticksOutOfRange / rangeWidth) * 100 : 0;

  return {
    position,
    pool,
    poolId,
    isInRange,
    ticksOutOfRange,
    percentOutOfRange,
  };
}

// ---------------------------------------------------------------------------
// Check position ownership
// ---------------------------------------------------------------------------

export async function getPositionOwner(
  tokenId: bigint,
  config: ChainConfig
): Promise<Address> {
  const client = getPublicClient(config);
  const result = await client.readContract({
    address: config.contracts.positionManager,
    abi: positionManagerAbi,
    functionName: 'ownerOf',
    args: [tokenId],
  });
  return result as Address;
}

// ---------------------------------------------------------------------------
// Read ERC20 / native ETH balances for a user
// ---------------------------------------------------------------------------

const erc20BalanceOfAbi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

export async function getTokenBalances(
  userAddress: Address,
  currency0: Address,
  currency1: Address,
  config: ChainConfig,
): Promise<{ balance0: bigint; balance1: bigint }> {
  const client = getPublicClient(config);

  const isNative0 = currency0.toLowerCase() === ZERO_ADDRESS.toLowerCase();
  const isNative1 = currency1.toLowerCase() === ZERO_ADDRESS.toLowerCase();

  const [balance0, balance1] = await Promise.all([
    isNative0
      ? client.getBalance({ address: userAddress })
      : client.readContract({
          address: currency0,
          abi: erc20BalanceOfAbi,
          functionName: 'balanceOf',
          args: [userAddress],
        }).then((r) => r as bigint),
    isNative1
      ? client.getBalance({ address: userAddress })
      : client.readContract({
          address: currency1,
          abi: erc20BalanceOfAbi,
          functionName: 'balanceOf',
          args: [userAddress],
        }).then((r) => r as bigint),
  ]);

  return { balance0, balance1 };
}
