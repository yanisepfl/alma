"use client";

import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/40 bg-card/50 px-4 py-3",
        className
      )}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-foreground">{value}</div>
      {sub && (
        <div className="mt-0.5 text-[11px] text-muted-foreground/50">{sub}</div>
      )}
    </div>
  );
}

export function TickRangeVisual({
  tickLower,
  tickUpper,
  currentTick,
  minPrice,
  maxPrice,
  currentPrice,
}: {
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  minPrice?: string;
  maxPrice?: string;
  currentPrice?: string;
}) {
  const range = tickUpper - tickLower;
  const padding = range * 0.2;
  const viewMin = tickLower - padding;
  const viewMax = tickUpper + padding;
  const viewRange = viewMax - viewMin;

  const rangeStart = ((tickLower - viewMin) / viewRange) * 100;
  const rangeEnd = ((tickUpper - viewMin) / viewRange) * 100;
  const currentPos = Math.max(
    0,
    Math.min(100, ((currentTick - viewMin) / viewRange) * 100)
  );
  const isInRange = currentTick >= tickLower && currentTick <= tickUpper;

  return (
    <div className="rounded-xl border border-border/40 bg-card/50 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
        Price Range
      </div>
      <div className="mt-2 mb-1">
        <svg viewBox="0 0 200 24" className="w-full h-6">
          {/* Background track */}
          <rect
            x="0"
            y="10"
            width="200"
            height="4"
            rx="2"
            fill="currentColor"
            className="text-muted/60"
          />
          {/* Active range */}
          <rect
            x={rangeStart * 2}
            y="10"
            width={Math.max(1, (rangeEnd - rangeStart) * 2)}
            height="4"
            rx="2"
            fill="currentColor"
            className="text-foreground/15"
          />
          {/* Range edges */}
          <line
            x1={rangeStart * 2}
            y1="6"
            x2={rangeStart * 2}
            y2="18"
            stroke="currentColor"
            strokeWidth="1"
            className="text-foreground/25"
          />
          <line
            x1={rangeEnd * 2}
            y1="6"
            x2={rangeEnd * 2}
            y2="18"
            stroke="currentColor"
            strokeWidth="1"
            className="text-foreground/25"
          />
          {/* Current price marker */}
          <circle
            cx={currentPos * 2}
            cy="12"
            r="3.5"
            fill="currentColor"
            fillOpacity="0.4"
            className={isInRange ? "text-green-500" : "text-red-500"}
          />
          <circle
            cx={currentPos * 2}
            cy="12"
            r="2"
            fill="currentColor"
            className={isInRange ? "text-green-500" : "text-red-500"}
          />
        </svg>
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground/50">
        <span>{minPrice ? parseFloat(minPrice).toFixed(4) : tickLower}</span>
        <span className="text-foreground/70">
          {currentPrice ? parseFloat(currentPrice).toFixed(4) : currentTick}
        </span>
        <span>{maxPrice ? parseFloat(maxPrice).toFixed(4) : tickUpper}</span>
      </div>
    </div>
  );
}
