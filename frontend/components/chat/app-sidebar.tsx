"use client";

import { PlusIcon } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { useAccount } from "wagmi";
import { usePositionContext } from "@/hooks/use-position-context";
import { cn } from "@/lib/utils";

export function AppSidebar() {
  const { address } = useAccount();
  const { positions, selectedPosition, selectPosition, clearSelection, loadPosition, isLoading } =
    usePositionContext();
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
        <div className="px-4 pb-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
            Positions
          </span>
        </div>
      )}

      {/* Position list */}
      <div className="flex-1 overflow-y-auto px-2">
        {!address && (
          <p className="px-2 pt-2 text-xs text-muted-foreground/50">
            Connect wallet to view positions
          </p>
        )}

        {positions.length === 0 && address && (
          <p className="px-2 pt-2 text-xs text-muted-foreground/50">
            No positions found
          </p>
        )}

        {positions.map((pos) => (
          <button
            key={pos.tokenId}
            onClick={() => selectPosition(pos.tokenId)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer",
              selectedPosition?.tokenId === pos.tokenId
                ? "bg-muted/60 text-foreground"
                : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
            )}
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                pos.isInRange
                  ? "bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.6)] animate-pulse"
                  : "bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.6)] animate-pulse"
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium truncate">
                {pos.token0Symbol} / {pos.token1Symbol}
              </div>
              <div className="text-[10px] text-muted-foreground/50">
                #{pos.tokenId}
              </div>
            </div>
          </button>
        ))}
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
          className="flex w-full items-center gap-2 rounded-lg border border-border/40 px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/30 cursor-pointer"
        >
          <PlusIcon className="size-3.5" />
          <span>Create new position</span>
        </a>
      </div>
    </div>
  );
}
