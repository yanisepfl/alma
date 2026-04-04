"use client";

import { motion } from "framer-motion";
import {
  ArrowLeftIcon,
  ActivityIcon,
  CheckCircleIcon,
  AlertCircleIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EnrichedPosition } from "@/lib/positions/types";
import { usePoolPrices, type PricePoint, type Duration } from "@/hooks/use-pool-prices";
import { usePositionContext } from "@/hooks/use-position-context";
import { cn } from "@/lib/utils";
import { API_URL } from "@/lib/delegation/constants";

// ── Helpers ──────────────────────────────────────────────────────────────

function formatUSD(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value > 0) return `$${value.toFixed(4)}`;
  return "$0.00";
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ── Price Chart (larger version) ─────────────────────────────────────────

function PriceChart({
  prices,
  tickLower,
  tickUpper,
  token0Symbol,
  token1Symbol,
}: {
  prices: PricePoint[];
  tickLower: number;
  tickUpper: number;
  token0Symbol: string;
  token1Symbol: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; price: number; time: number } | null>(null);

  const priceValues = prices.map((p) => p.token0Price);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || priceValues.length < 2) return;
    const rect = containerRef.current.getBoundingClientRect();
    const xRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const idx = Math.round(xRatio * (prices.length - 1));
    const pt = prices[idx];
    if (pt) setHover({ x: xRatio * 100, price: pt.token0Price, time: pt.timestamp });
  }, [prices, priceValues.length]);

  if (priceValues.length < 2) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <span className="text-xs text-muted-foreground/40">Loading chart...</span>
      </div>
    );
  }

  const tickToPrice = (tick: number) => Math.pow(1.0001, tick);
  const lowerPrice = tickToPrice(tickLower);
  const upperPrice = tickToPrice(tickUpper);

  const minP = Math.min(...priceValues);
  const maxP = Math.max(...priceValues);
  const pricePad = (maxP - minP) * 0.15 || maxP * 0.02;

  let yMin = minP - pricePad;
  let yMax = maxP + pricePad;

  const showLowerRange = lowerPrice >= minP - pricePad;
  const showUpperRange = upperPrice <= maxP + pricePad;
  if (showLowerRange) yMin = Math.min(yMin, lowerPrice - pricePad * 0.5);
  if (showUpperRange) yMax = Math.max(yMax, upperPrice + pricePad * 0.5);

  const yRange = yMax - yMin || 1;
  const priceToY = (p: number) => 100 - ((p - yMin) / yRange) * 100;

  const segments: { d: string; inRange: boolean }[] = [];
  let currentSegment: { points: string[]; inRange: boolean } | null = null;

  for (let i = 0; i < priceValues.length; i++) {
    const p = priceValues[i];
    const x = (i / (priceValues.length - 1)) * 100;
    const y = priceToY(p);
    const pointInRange = p >= lowerPrice && p <= upperPrice;
    const coord = `${x.toFixed(2)} ${y.toFixed(2)}`;

    if (!currentSegment || currentSegment.inRange !== pointInRange) {
      if (currentSegment) {
        segments.push({ d: "M " + currentSegment.points.join(" L "), inRange: currentSegment.inRange });
      }
      currentSegment = {
        points: currentSegment ? [currentSegment.points[currentSegment.points.length - 1], coord] : [coord],
        inRange: pointInRange,
      };
    } else {
      currentSegment.points.push(coord);
    }
  }
  if (currentSegment) {
    segments.push({ d: "M " + currentSegment.points.join(" L "), inRange: currentSegment.inRange });
  }

  const rangeTopY = priceToY(upperPrice);
  const rangeBotY = priceToY(lowerPrice);
  const hoverY = hover ? priceToY(hover.price) : 0;

  const STABLES = ["USDC", "USDS", "USDT", "DAI"];
  const isUSDPair = STABLES.includes(token1Symbol) || STABLES.includes(token0Symbol);
  const formatPrice = (p: number) => p >= 1 ? p.toFixed(2) : p.toFixed(6);
  const formatRangeLabel = (p: number) => isUSDPair ? `$${formatPrice(p)}` : formatPrice(p);
  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " +
      d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="relative w-full h-full" ref={containerRef}
      onMouseMove={handleMouseMove} onMouseLeave={() => setHover(null)}
    >
      {/* Range labels on right edge */}
      {showUpperRange && (
        <div className="absolute right-1 text-[9px] text-muted-foreground/40 pointer-events-none"
          style={{ top: `${rangeTopY}%`, transform: "translateY(-100%)" }}>
          {formatRangeLabel(upperPrice)}
        </div>
      )}
      {showLowerRange && (
        <div className="absolute right-1 text-[9px] text-muted-foreground/40 pointer-events-none"
          style={{ top: `${rangeBotY}%` }}>
          {formatRangeLabel(lowerPrice)}
        </div>
      )}

      {/* Tooltip */}
      {hover && (
        <>
          <div className="absolute top-0 pointer-events-none z-10"
            style={{ left: `${hover.x}%`, transform: "translateX(-50%)" }}>
            <div className="bg-card border border-border/60 rounded-lg px-2.5 py-1.5 shadow-lg">
              <div className="text-[11px] font-medium text-foreground">
                {isUSDPair ? "$" : ""}{formatPrice(hover.price)}{!isUSDPair ? ` ${token1Symbol}` : ""}
              </div>
              <div className="text-[9px] text-muted-foreground/50">{formatTime(hover.time)}</div>
            </div>
          </div>
          {/* Dot positioned via CSS to stay circular */}
          <div
            className="absolute size-2 rounded-full bg-white pointer-events-none z-10"
            style={{ left: `${hover.x}%`, top: `${hoverY}%`, transform: "translate(-50%, -50%)" }}
          />
        </>
      )}

      <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="none">
        {/* Range band */}
        {(showLowerRange || showUpperRange) && (
          <rect
            x="0" y={showUpperRange ? rangeTopY : 0}
            width="100"
            height={Math.max(0.5, (showLowerRange ? rangeBotY : 100) - (showUpperRange ? rangeTopY : 0))}
            fill="white" fillOpacity="0.03"
          />
        )}
        {/* Range lines */}
        {showUpperRange && (
          <line x1="0" y1={rangeTopY} x2="100" y2={rangeTopY}
            stroke="white" strokeWidth="0.5" strokeOpacity="0.12" strokeDasharray="2,2"
            vectorEffect="non-scaling-stroke" />
        )}
        {showLowerRange && (
          <line x1="0" y1={rangeBotY} x2="100" y2={rangeBotY}
            stroke="white" strokeWidth="0.5" strokeOpacity="0.12" strokeDasharray="2,2"
            vectorEffect="non-scaling-stroke" />
        )}
        {/* Price line */}
        {segments.map((seg, i) => (
          <path key={i} d={seg.d} fill="none"
            stroke={seg.inRange ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)"}
            strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        ))}
        {/* Hover vertical line */}
        {hover && (
          <line x1={hover.x} y1="0" x2={hover.x} y2="100"
            stroke="white" strokeWidth="0.5" strokeOpacity="0.15"
            vectorEffect="non-scaling-stroke" />
        )}
      </svg>
    </div>
  );
}

const DURATIONS: { label: string; value: Duration }[] = [
  { label: "1H", value: "HOUR" },
  { label: "1D", value: "DAY" },
  { label: "1W", value: "WEEK" },
  { label: "1M", value: "MONTH" },
  { label: "1Y", value: "YEAR" },
];

// ── Actions List ─────────────────────────────────────────────────────────

interface Action {
  type: string;
  status: string;
  summary: string;
  timestamp: number;
  tokenId?: string;
}

function ActionsList({ tokenId }: { tokenId: string }) {
  const [actions, setActions] = useState<Action[]>([]);

  useEffect(() => {
    const fetchActions = () => {
      fetch(`${API_URL}/api/actions`)
        .then((r) => r.json())
        .then((data: Action[]) => {
          const filtered = data.filter((a) => !a.tokenId || a.tokenId === tokenId);
          setActions(filtered.slice(0, 10));
        })
        .catch(() => {});
    };
    fetchActions();
    const interval = setInterval(fetchActions, 15_000);
    return () => clearInterval(interval);
  }, [tokenId]);

  if (actions.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-xs text-muted-foreground/40">
        No actions yet — agent will monitor this position
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {actions.map((action, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded-lg border border-border/50 bg-card px-3 py-2.5"
        >
          <div className="mt-0.5">
            {action.status === "completed" ? (
              <CheckCircleIcon className="size-3.5 text-muted-foreground" />
            ) : action.status === "failed" ? (
              <AlertCircleIcon className="size-3.5 text-red-400" />
            ) : (
              <ActivityIcon className="size-3.5 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-foreground/80 leading-relaxed">{action.summary}</p>
            <p className="text-[10px] text-muted-foreground/40 mt-0.5">{timeAgo(action.timestamp)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Dashboard ───────────────────────────────────────────────────────

export function PositionDashboard({
  position,
}: {
  position: EnrichedPosition;
  onSuggestedAction?: (text: string) => void;
}) {
  const m = position.metrics;
  const [duration, setDuration] = useState<Duration>("WEEK");
  const { prices } = usePoolPrices(position.pool.poolId, duration);
  const { clearSelection } = usePositionContext();

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-6">
      {/* Back button + title */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={clearSelection}
          className="rounded-lg p-1.5 text-muted-foreground/60 hover:text-foreground hover:bg-muted/30 transition-colors cursor-pointer"
        >
          <ArrowLeftIcon className="size-4" />
        </button>
        <h2 className="text-lg font-semibold tracking-tight">
          {position.token0Symbol} / {position.token1Symbol}
        </h2>
        <div className="flex items-center gap-1.5">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <circle cx="4" cy="4" r="4" fill="currentColor" fillOpacity="0.4"
              className={position.isInRange ? "text-green-500" : "text-red-500"} />
            <circle cx="4" cy="4" r="2" fill="currentColor"
              className={position.isInRange ? "text-green-500" : "text-red-500"} />
          </svg>
          <span className={cn("text-xs font-medium", position.isInRange ? "text-green-500" : "text-red-400")}>
            {position.isInRange ? "In Range" : "Out of Range"}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/40">#{position.tokenId}</span>
      </div>

      {/* Chart + Stats row */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        {/* Chart — takes 3 columns */}
        <motion.div
          className="col-span-3 rounded-xl border border-border/50 bg-card p-3 h-[240px] flex flex-col"
          animate={{ opacity: 1, y: 0 }}
          initial={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.3 }}
        >
          {/* Time selector row */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-muted-foreground/50">
              {position.token0Symbol} Price (in {position.token1Symbol})
            </span>
            <div className="flex gap-0.5">
              {DURATIONS.map((d) => (
                <button
                  key={d.value}
                  onClick={() => setDuration(d.value)}
                  className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer",
                    duration === d.value
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground/40 hover:text-muted-foreground"
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <PriceChart
              prices={prices}
              tickLower={position.tickLower}
              tickUpper={position.tickUpper}
              token0Symbol={position.token0Symbol}
              token1Symbol={position.token1Symbol}
            />
          </div>
        </motion.div>

        {/* 2x2 Stats — takes 2 columns */}
        <div className="col-span-2 grid grid-cols-2 gap-3">
          <motion.div
            animate={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 6 }}
            transition={{ delay: 0.05, duration: 0.3 }}
            className="rounded-xl border border-border/50 bg-card px-4 py-3"
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Size</div>
            <div className="mt-1 text-sm font-medium">{m ? formatUSD(m.positionSizeUSD) : "—"}</div>
            {m && (
              <div className="mt-0.5 text-[10px] text-muted-foreground/40">
                {parseFloat(m.amount0).toFixed(4)} {position.token0Symbol}
              </div>
            )}
          </motion.div>

          <motion.div
            animate={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 6 }}
            transition={{ delay: 0.1, duration: 0.3 }}
            className="rounded-xl border border-border/50 bg-card px-4 py-3"
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Fees</div>
            <div className="mt-1 text-sm font-medium">{m ? formatUSD(m.feesEarnedUSD) : "—"}</div>
            {m && (
              <div className="mt-0.5 text-[10px] text-muted-foreground/40">{m.feePercent} fee tier</div>
            )}
          </motion.div>

          <motion.div
            animate={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 6 }}
            transition={{ delay: 0.15, duration: 0.3 }}
            className="rounded-xl border border-border/50 bg-card px-4 py-3"
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Price</div>
            <div className="mt-1 text-sm font-medium">
              {m ? parseFloat(m.currentPrice).toFixed(2) : "—"}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground/40">
              {position.token1Symbol}/{position.token0Symbol}
            </div>
          </motion.div>

          <motion.div
            animate={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 6 }}
            transition={{ delay: 0.2, duration: 0.3 }}
            className="rounded-xl border border-border/50 bg-card px-4 py-3"
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">APY</div>
            <div className="mt-1 text-sm font-medium">
              {m?.apyEstimate != null ? `${m.apyEstimate.toFixed(1)}%` : "—"}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground/40">estimated</div>
          </motion.div>
        </div>
      </div>

      {/* Actions history */}
      <motion.div
        animate={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 6 }}
        transition={{ delay: 0.25, duration: 0.3 }}
      >
        <h3 className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider mb-3">
          Agent Activity
        </h3>
        <ActionsList tokenId={position.tokenId} />
      </motion.div>
    </div>
  );
}
