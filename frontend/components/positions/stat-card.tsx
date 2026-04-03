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
        "rounded-xl border border-border/30 bg-card/50 px-4 py-3 shadow-[var(--shadow-card)]",
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
}: {
  tickLower: number;
  tickUpper: number;
  currentTick: number;
}) {
  const range = tickUpper - tickLower;
  const padding = range * 0.2;
  const viewMin = tickLower - padding;
  const viewMax = tickUpper + padding;
  const viewRange = viewMax - viewMin;

  const rangeStart = ((tickLower - viewMin) / viewRange) * 100;
  const rangeEnd = ((tickUpper - viewMin) / viewRange) * 100;
  const currentPos = Math.max(0, Math.min(100, ((currentTick - viewMin) / viewRange) * 100));
  const isInRange = currentTick >= tickLower && currentTick <= tickUpper;

  return (
    <div className="rounded-xl border border-border/30 bg-card/50 px-4 py-3 shadow-[var(--shadow-card)]">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
        Tick Range
      </div>
      <div className="mt-2 mb-1">
        <svg viewBox="0 0 200 24" className="w-full h-6">
          {/* Background */}
          <rect x="0" y="10" width="200" height="4" rx="2" fill="currentColor" className="text-muted/60" />
          {/* Active range */}
          <rect
            x={rangeStart * 2}
            y="10"
            width={Math.max(1, (rangeEnd - rangeStart) * 2)}
            height="4"
            rx="2"
            fill="currentColor"
            className="text-foreground/20"
          />
          {/* Current tick marker */}
          <circle
            cx={currentPos * 2}
            cy="12"
            r="4"
            fill="currentColor"
            className={isInRange ? "text-foreground" : "text-muted-foreground/40"}
          />
        </svg>
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground/50">
        <span>{tickLower}</span>
        <span className="text-foreground/70">{currentTick}</span>
        <span>{tickUpper}</span>
      </div>
    </div>
  );
}
