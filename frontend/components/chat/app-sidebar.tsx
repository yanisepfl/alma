"use client";

import { PlusIcon } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { usePositionContext } from "@/hooks/use-position-context";
import { cn } from "@/lib/utils";

function StatusDot({ inRange }: { inRange: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <circle
        cx="5"
        cy="5"
        r="5"
        fill="currentColor"
        fillOpacity="0.4"
        className={inRange ? "text-green-500" : "text-red-500"}
      />
      <circle
        cx="5"
        cy="5"
        r="2.5"
        fill="currentColor"
        className={inRange ? "text-green-500" : "text-red-500"}
      />
    </svg>
  );
}

export function AppSidebar() {
  const {
    positions,
    selectedPosition,
    selectPosition,
    clearSelection,
    loadPosition,
    isLoading,
  } = usePositionContext();
  const [tokenIdInput, setTokenIdInput] = useState("");

  return (
    <div className="flex h-dvh w-[16rem] shrink-0 flex-col border-r border-border/40 bg-sidebar">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <button
          onClick={clearSelection}
          className="flex items-center gap-2 cursor-pointer"
        >
          <Image
            src="/logo.png"
            alt="Alma"
            width={16}
            height={16}
            className="dark:invert"
          />
          <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">
            Alma
          </span>
        </button>
      </div>

      {/* Positions label */}
      {positions.length > 0 && (
        <div className="px-4 pb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
            Positions
          </span>
        </div>
      )}

      {/* Position list */}
      <div className="flex-1 overflow-y-auto px-2 space-y-1.5">
        {positions.length === 0 && (
          <p className="px-2 pt-2 text-xs text-muted-foreground/50">
            Connect wallet to view positions
          </p>
        )}

        {positions.map((pos) => {
          const range = pos.tickUpper - pos.tickLower;
          const padding = range * 0.15;
          const viewMin = pos.tickLower - padding;
          const viewRange = range + padding * 2;
          const barStart =
            ((pos.tickLower - viewMin) / viewRange) * 100;
          const barEnd =
            ((pos.tickUpper - viewMin) / viewRange) * 100;
          const tickPos = Math.max(
            0,
            Math.min(
              100,
              ((pos.pool.currentTick - viewMin) / viewRange) * 100
            )
          );

          return (
            <button
              key={pos.tokenId}
              onClick={() => selectPosition(pos.tokenId)}
              className={cn(
                "flex w-full flex-col gap-2 rounded-lg border p-3 text-left transition-colors cursor-pointer",
                selectedPosition?.tokenId === pos.tokenId
                  ? "border-border/60 bg-muted/40 text-foreground"
                  : "border-border/20 text-muted-foreground hover:border-border/40 hover:bg-muted/20 hover:text-foreground"
              )}
            >
              {/* Top row: token pair + status dot */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium">
                    {pos.token0Symbol} / {pos.token1Symbol}
                  </div>
                  <div className="text-[10px] text-muted-foreground/40 mt-0.5">
                    {pos.isInRange ? "In Range" : "Out of Range"}
                  </div>
                </div>
                <StatusDot inRange={pos.isInRange} />
              </div>

              {/* Mini range bar */}
              <div className="w-full h-1 rounded-full bg-muted/60 relative mt-1">
                <div
                  className="absolute h-full rounded-full bg-foreground/10"
                  style={{
                    left: `${barStart}%`,
                    width: `${Math.max(1, barEnd - barStart)}%`,
                  }}
                />
                <div
                  className={cn(
                    "absolute top-1/2 -translate-y-1/2 size-1.5 rounded-full",
                    pos.isInRange ? "bg-green-500" : "bg-red-500"
                  )}
                  style={{ left: `${tickPos}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Bottom: Add position + Create new */}
      <div className="border-t border-border/30 p-3 space-y-2">
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (tokenIdInput.trim()) {
              loadPosition(tokenIdInput.trim());
              setTokenIdInput("");
            }
          }}
        >
          <input
            className="flex-1 rounded-md border border-border/40 bg-transparent px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            placeholder="Token ID"
            value={tokenIdInput}
            onChange={(e) => setTokenIdInput(e.target.value)}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !tokenIdInput.trim()}
            className="rounded-md border border-border/40 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/30 disabled:opacity-30 cursor-pointer"
          >
            {isLoading ? "..." : "Add"}
          </button>
        </form>

        <a
          href="https://app.uniswap.org/positions/create/v4"
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center gap-2 rounded-lg border border-border/40 px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/20 cursor-pointer"
        >
          <PlusIcon className="size-3.5" />
          <span>Create new position</span>
        </a>
      </div>
    </div>
  );
}
