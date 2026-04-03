export type PoolKey = {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
};

export type PositionInfo = {
  tokenId: string;
  poolKey: PoolKey;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
};

export type PoolState = {
  poolId: `0x${string}`;
  sqrtPriceX96: bigint;
  currentTick: number;
  totalLiquidity: bigint;
};

export type EnrichedPosition = PositionInfo & {
  pool: PoolState;
  isInRange: boolean;
  percentOutOfRange: number;
  token0Symbol: string;
  token1Symbol: string;
};
