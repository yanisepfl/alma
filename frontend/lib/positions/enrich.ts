import { type PublicClient, parseAbi } from "viem";
import { Token, Ether, type Currency } from "@uniswap/sdk-core";
import { Pool as V4Pool, Position as V4Position } from "@uniswap/v4-sdk";
import JSBI from "jsbi";
import type { EnrichedPosition } from "./types";
import { POSITION_MANAGER, STATE_VIEW, CHAIN_ID } from "./constants";
import { getTokenPrices } from "./prices";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Extended StateView ABI for fee queries
const FEE_ABI = parseAbi([
  "function getPositionInfo(bytes32 poolId, address owner, int24 tickLower, int24 tickUpper, bytes32 salt) external view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128)",
  "function getFeeGrowthInside(bytes32 poolId, int24 tickLower, int24 tickUpper) external view returns (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128)",
]);

const Q128 = 2n ** 128n;
const UINT256 = 2n ** 256n;

function getTokenDecimals(symbol: string): number {
  const decimals: Record<string, number> = {
    ETH: 18, WETH: 18, USDC: 6, USDS: 18, cbBTC: 8,
  };
  return decimals[symbol] ?? 18;
}

function makeCurrency(address: string, symbol: string): Currency {
  if (address.toLowerCase() === ZERO_ADDRESS) {
    return Ether.onChain(CHAIN_ID);
  }
  return new Token(CHAIN_ID, address, getTokenDecimals(symbol), symbol);
}

import type { PositionMetrics } from "./types";
export type { PositionMetrics };

export async function enrichPosition(
  position: EnrichedPosition,
  publicClient: PublicClient
): Promise<PositionMetrics> {
  const { poolKey, tickLower, tickUpper, liquidity, pool, token0Symbol, token1Symbol } = position;

  // 1. Create SDK objects
  const currency0 = makeCurrency(poolKey.currency0, token0Symbol);
  const currency1 = makeCurrency(poolKey.currency1, token1Symbol);

  const v4Pool = new V4Pool(
    currency0,
    currency1,
    poolKey.fee,
    poolKey.tickSpacing,
    poolKey.hooks,
    JSBI.BigInt(pool.sqrtPriceX96.toString()),
    JSBI.BigInt(pool.totalLiquidity.toString()),
    pool.currentTick
  );

  const v4Position = new V4Position({
    pool: v4Pool,
    tickLower,
    tickUpper,
    liquidity: JSBI.BigInt(liquidity.toString()),
  });

  const amount0Raw = v4Position.amount0.quotient.toString();
  const amount1Raw = v4Position.amount1.quotient.toString();
  const dec0 = getTokenDecimals(token0Symbol);
  const dec1 = getTokenDecimals(token1Symbol);
  const amount0 = formatUnits(amount0Raw, dec0);
  const amount1 = formatUnits(amount1Raw, dec1);

  // 2. Get USD prices
  const prices = await getTokenPrices([token0Symbol, token1Symbol]);
  const price0 = prices[token0Symbol] ?? 0;
  const price1 = prices[token1Symbol] ?? 0;

  const positionSizeUSD = parseFloat(amount0) * price0 + parseFloat(amount1) * price1;

  // 3. Compute current price and range prices using SDK
  const currentPrice = v4Pool.token0Price.toSignificant(8);

  // Price at tickLower and tickUpper
  const { tickToPrice } = await import("@uniswap/v4-sdk");
  const minPriceObj = tickToPrice(currency0, currency1, tickLower);
  const maxPriceObj = tickToPrice(currency0, currency1, tickUpper);
  const minPrice = minPriceObj.toSignificant(8);
  const maxPrice = maxPriceObj.toSignificant(8);

  // 4. Fetch unclaimed fees
  let fee0Raw = 0n;
  let fee1Raw = 0n;

  try {
    const tokenIdSalt = `0x${BigInt(position.tokenId).toString(16).padStart(64, "0")}` as `0x${string}`;

    const [posInfoResult, feeGrowthResult] = await publicClient.multicall({
      contracts: [
        {
          address: STATE_VIEW,
          abi: FEE_ABI,
          functionName: "getPositionInfo",
          args: [pool.poolId, POSITION_MANAGER, tickLower, tickUpper, tokenIdSalt],
        },
        {
          address: STATE_VIEW,
          abi: FEE_ABI,
          functionName: "getFeeGrowthInside",
          args: [pool.poolId, tickLower, tickUpper],
        },
      ],
      allowFailure: true,
    });

    if (posInfoResult.status === "success" && feeGrowthResult.status === "success") {
      const [posLiq, fgInside0Last, fgInside1Last] = posInfoResult.result as [bigint, bigint, bigint];
      const [fgInside0Current, fgInside1Current] = feeGrowthResult.result as [bigint, bigint];

      const delta0 = (fgInside0Current - fgInside0Last + UINT256) % UINT256;
      const delta1 = (fgInside1Current - fgInside1Last + UINT256) % UINT256;

      fee0Raw = (delta0 * posLiq) / Q128;
      fee1Raw = (delta1 * posLiq) / Q128;
    }
  } catch (err) {
    console.warn("Fee calculation failed:", err);
  }

  const fee0 = formatUnits(fee0Raw.toString(), dec0);
  const fee1 = formatUnits(fee1Raw.toString(), dec1);
  const feesEarnedUSD = parseFloat(fee0) * price0 + parseFloat(fee1) * price1;

  // 5. Fee percentage
  // Uniswap V4: fee is in hundredths of a bip (1e-6), or for dynamic fees it can be larger
  const feePercent = poolKey.fee >= 1_000_000
    ? "Dynamic"
    : `${(poolKey.fee / 10_000).toFixed(2)}%`;

  // 6. APY estimate (annualized fees / position size)
  // Very rough: assume fees earned since position creation
  // Without creation timestamp, we use a conservative 30-day assumption
  let apyEstimate: number | null = null;
  if (positionSizeUSD > 0 && feesEarnedUSD > 0) {
    // Rough: assume 30 days of fee accumulation
    const dailyReturn = feesEarnedUSD / 30;
    apyEstimate = (dailyReturn * 365 / positionSizeUSD) * 100;
  }

  return {
    amount0,
    amount1,
    amount0Raw,
    amount1Raw,
    positionSizeUSD,
    fee0Raw,
    fee1Raw,
    fee0,
    fee1,
    feesEarnedUSD,
    poolTvlUSD: null, // Would need full pool token amounts + prices
    feePercent,
    token0PriceUSD: price0,
    token1PriceUSD: price1,
    currentPrice,
    minPrice,
    maxPrice,
    apyEstimate,
  };
}

function formatUnits(value: string, decimals: number): string {
  const padded = value.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals) || "0";
  const fracPart = padded.slice(padded.length - decimals);
  const trimmed = fracPart.replace(/0+$/, "");
  return trimmed ? `${intPart}.${trimmed}` : intPart;
}
