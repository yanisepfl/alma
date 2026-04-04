"use client";

import { useEffect, useState } from "react";

export interface PricePoint {
  timestamp: number;
  token0Price: number;
  token1Price: number;
}

const cache = new Map<string, { prices: PricePoint[]; ts: number }>();
const CACHE_TTL = 60_000; // 1 min

export function usePoolPrices(poolId?: string) {
  const [prices, setPrices] = useState<PricePoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!poolId) return;

    const cached = cache.get(poolId);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setPrices(cached.prices);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    fetch(`/api/pool-prices?poolId=${poolId}&duration=WEEK`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const data: PricePoint[] = json.data ?? [];
        cache.set(poolId, { prices: data, ts: Date.now() });
        setPrices(data);
      })
      .catch(() => {
        if (!cancelled) setPrices([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [poolId]);

  return { prices, isLoading };
}
