"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAccount, usePublicClient } from "wagmi";
import { parseAbiItem } from "viem";
import type { EnrichedPosition, PoolKey } from "@/lib/positions/types";
import {
  POSITION_MANAGER,
  POSITION_MANAGER_ABI,
  STATE_VIEW,
  STATE_VIEW_ABI,
} from "@/lib/positions/constants";
import {
  calculateRangeStatus,
  computePoolId,
  decodePositionInfo,
  getTokenSymbol,
} from "@/lib/positions/utils";

type PositionContextValue = {
  positions: EnrichedPosition[];
  selectedPosition: EnrichedPosition | null;
  selectPosition: (tokenId: string) => void;
  clearSelection: () => void;
  loadPosition: (tokenId: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
};

const PositionContext = createContext<PositionContextValue | null>(null);

export function PositionProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [positions, setPositions] = useState<EnrichedPosition[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPosition = useMemo(
    () => positions.find((p) => p.tokenId === selectedId) ?? null,
    [positions, selectedId]
  );

  const loadPosition = useCallback(
    async (tokenId: string) => {
      if (!publicClient) {
        setError("No RPC client available");
        return;
      }

      // Don't reload if already loaded
      if (positions.find((p) => p.tokenId === tokenId)) {
        setSelectedId(tokenId);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const tokenIdBigInt = BigInt(tokenId);

        // Batch: get position info + liquidity
        const [infoResult, liquidityResult] = await publicClient.multicall({
          contracts: [
            {
              address: POSITION_MANAGER,
              abi: POSITION_MANAGER_ABI,
              functionName: "getPoolAndPositionInfo",
              args: [tokenIdBigInt],
            },
            {
              address: POSITION_MANAGER,
              abi: POSITION_MANAGER_ABI,
              functionName: "getPositionLiquidity",
              args: [tokenIdBigInt],
            },
          ],
          allowFailure: false,
        });

        const [poolKey, packedInfo] = infoResult as [PoolKey, bigint];
        const liquidity = liquidityResult as bigint;
        const { tickLower, tickUpper } = decodePositionInfo(packedInfo);

        // Compute pool ID and fetch pool state
        const poolId = computePoolId(poolKey);

        const [slot0Result, poolLiqResult] = await publicClient.multicall({
          contracts: [
            {
              address: STATE_VIEW,
              abi: STATE_VIEW_ABI,
              functionName: "getSlot0",
              args: [poolId],
            },
            {
              address: STATE_VIEW,
              abi: STATE_VIEW_ABI,
              functionName: "getLiquidity",
              args: [poolId],
            },
          ],
          allowFailure: false,
        });

        const [sqrtPriceX96, currentTick] = slot0Result as [bigint, number, number, number];
        const totalLiquidity = poolLiqResult as bigint;

        const { isInRange, percentOutOfRange } = calculateRangeStatus(
          tickLower,
          tickUpper,
          currentTick
        );

        const enriched: EnrichedPosition = {
          tokenId,
          poolKey,
          tickLower,
          tickUpper,
          liquidity,
          pool: { poolId, sqrtPriceX96, currentTick, totalLiquidity },
          isInRange,
          percentOutOfRange,
          token0Symbol: getTokenSymbol(poolKey.currency0),
          token1Symbol: getTokenSymbol(poolKey.currency1),
        };

        setPositions((prev) => {
          const existing = prev.findIndex((p) => p.tokenId === tokenId);
          if (existing >= 0) {
            const next = [...prev];
            next[existing] = enriched;
            return next;
          }
          return [...prev, enriched];
        });
        setSelectedId(tokenId);
      } catch (err) {
        console.error("Failed to load position:", err);
        setError("Failed to load position. Check the token ID.");
      } finally {
        setIsLoading(false);
      }
    },
    [publicClient, positions]
  );

  // Auto-discover positions when wallet connects
  const hasDiscovered = useRef(false);
  useEffect(() => {
    if (!address || !publicClient || hasDiscovered.current) return;
    hasDiscovered.current = true;

    (async () => {
      try {
        // Query ERC-721 Transfer events TO this address (last ~100k blocks)
        const transferEvent = parseAbiItem(
          "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
        );
        const currentBlock = await publicClient.getBlockNumber();
        const fromBlock = currentBlock > 100000n ? currentBlock - 100000n : 0n;
        const logs = await publicClient.getLogs({
          address: POSITION_MANAGER,
          event: transferEvent,
          args: { to: address },
          fromBlock,
          toBlock: "latest",
        });

        // Get unique token IDs received
        const received = new Set(
          logs.map((l) => l.args.tokenId!.toString())
        );

        // Check which ones are still owned by the user
        if (received.size === 0) return;

        const tokenIds = [...received];
        const ownerCalls = tokenIds.map((id) => ({
          address: POSITION_MANAGER as `0x${string}`,
          abi: POSITION_MANAGER_ABI,
          functionName: "ownerOf" as const,
          args: [BigInt(id)] as const,
        }));

        const owners = await publicClient.multicall({
          contracts: ownerCalls,
          allowFailure: true,
        });

        const ownedIds = tokenIds.filter((_, i) => {
          const result = owners[i];
          return (
            result.status === "success" &&
            (result.result as string).toLowerCase() === address.toLowerCase()
          );
        });

        // Load each owned position
        for (const id of ownedIds) {
          await loadPosition(id);
        }
      } catch (err) {
        console.error("Failed to discover positions:", err);
      }
    })();
  }, [address, publicClient, loadPosition]);

  // Reset when wallet disconnects
  useEffect(() => {
    if (!address) {
      hasDiscovered.current = false;
      setPositions([]);
      setSelectedId(null);
    }
  }, [address]);

  const selectPosition = useCallback((tokenId: string) => {
    setSelectedId(tokenId);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
  }, []);

  const value = useMemo<PositionContextValue>(
    () => ({
      positions,
      selectedPosition,
      selectPosition,
      clearSelection,
      loadPosition,
      isLoading,
      error,
    }),
    [positions, selectedPosition, selectPosition, clearSelection, loadPosition, isLoading, error]
  );

  return (
    <PositionContext.Provider value={value}>
      {children}
    </PositionContext.Provider>
  );
}

export function usePositionContext() {
  const context = useContext(PositionContext);
  if (!context) {
    throw new Error("usePositionContext must be used within PositionProvider");
  }
  return context;
}
