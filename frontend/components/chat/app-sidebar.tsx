"use client";

import { IconRefreshClockwise, IconCheck, IconCircleInfo } from "nucleo-micro-bold-essential";
import Image from "next/image";
import { useEffect, useState } from "react";
import { usePositionContext } from "@/hooks/use-position-context";
import { useAccount } from "wagmi";

import { API_URL } from "@/lib/delegation/constants";
const AGENT_API = API_URL;

interface AgentAction {
  id: string;
  type: "rebalance" | "claim" | "monitor" | "delegation" | "registration";
  status: "completed" | "pending" | "evaluating" | "in_progress" | "failed";
  summary: string;
  timestamp: number;
  tokenId?: string;
  owner?: string;
  txHashes?: string[];
}

function timeAgo(ts: number | string): string {
  const ms = typeof ts === "string" ? new Date(ts).getTime() : ts;
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Convert a Uniswap tick to a human-readable price using price = 1.0001^tick.
 * If the result is in a plausible dollar range (0.01–100,000), format as $X.XX
 * (stablecoin pairs where token1 is USDC/USDS/USDT/DAI naturally land here).
 * Otherwise show the raw price to ~4 significant digits.
 */
function tickToPrice(tick: number): string {
  const price = Math.pow(1.0001, tick);
  if (price >= 0.01 && price <= 100_000) {
    return `$${price.toFixed(2)}`;
  }
  return price.toPrecision(4);
}

/**
 * Find tick-range patterns like `[-200580, -199380]` or standalone ticks like
 * `tick -200580` in a summary string and convert them to approximate prices.
 */
function formatTickSummary(summary: string): string {
  // Replace tick range patterns: [tickLower, tickUpper]
  let result = summary.replace(
    /\[(-?\d+),\s*(-?\d+)\]/g,
    (_match, lower, upper) => {
      const priceLower = tickToPrice(Number(lower));
      const priceUpper = tickToPrice(Number(upper));
      return `[${priceLower}, ${priceUpper}]`;
    }
  );

  // Replace standalone "tick <number>" patterns (e.g. "tick -200580 in")
  result = result.replace(
    /tick\s+(-?\d+)/g,
    (_match, t) => {
      return `tick ${tickToPrice(Number(t))}`;
    }
  );

  return result;
}

const STATUS_ICON = {
  completed: IconCheck,
  pending: IconCircleInfo,
  evaluating: IconCircleInfo,
  in_progress: IconCircleInfo,
  failed: IconCircleInfo,
};

export function AppSidebar() {
  const { clearSelection } = usePositionContext();
  const { address } = useAccount();
  const [actions, setActions] = useState<AgentAction[]>([]);

  useEffect(() => {
    if (!address) {
      setActions([]);
      return;
    }

    const fetchActions = () => {
      const params = new URLSearchParams({ limit: "15" });
      params.set("address", address);
      fetch(`${AGENT_API}/api/actions?${params}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          const arr = Array.isArray(data) ? data : data?.actions;
          if (Array.isArray(arr)) {
            const filtered = arr.filter(
              (a: AgentAction) =>
                a.type !== "monitor" &&
                a.owner?.toLowerCase() === address.toLowerCase()
            );
            setActions(filtered);
          }
        })
        .catch(() => {});
    };
    fetchActions();
    const interval = setInterval(fetchActions, 15_000);
    return () => clearInterval(interval);
  }, [address]);

  return (
    <div className="flex h-dvh w-[16rem] shrink-0 flex-col border-r border-border/40 bg-sidebar">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
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
          <span className="text-xl font-[family-name:var(--font-serif)] text-sidebar-foreground">
            Alma
          </span>
        </button>
      </div>

      {/* Agent Actions label */}
      <div className="px-4 pb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
          Agent Actions
        </span>
      </div>

      {/* Action list */}
      <div className="flex-1 overflow-y-auto px-3 space-y-2">
        {!address ? (
          <div className="flex items-center justify-center h-20 text-[11px] text-muted-foreground/40">
            Connect wallet to see activity
          </div>
        ) : actions.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-[11px] text-muted-foreground/40">
            No actions yet
          </div>
        ) : (
          actions.map((action) => {
            const Icon = action.type === "rebalance" ? IconRefreshClockwise : STATUS_ICON[action.status] || IconCircleInfo;
            const titles: Record<string, string> = {
              rebalance: "Rebalance",
              claim: "Claim Fees",
              delegation: "Delegation",
              registration: "Registered",
            };
            return (
              <div
                key={action.id}
                className="rounded-xl border border-border/50 bg-card/30 p-3 transition-colors duration-150 hover:bg-card/50 cursor-pointer"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon className="size-3.5 text-muted-foreground" />
                  <span className="text-[12px] font-medium text-sidebar-foreground">
                    {titles[action.type] ?? action.type}
                  </span>
                  {action.status === "failed" && (
                    <span className="text-[9px] text-red-400 font-medium">FAILED</span>
                  )}
                  <span className="ml-auto text-[9px] text-muted-foreground/40">
                    {timeAgo(action.timestamp)}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground/70 leading-snug">
                  {formatTickSummary(action.summary)}
                </p>
                {action.txHashes?.[0] && (
                  <a
                    href={`https://basescan.org/tx/${action.txHashes[0]}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[9px] text-blue-400/50 hover:text-blue-400 mt-1 inline-block transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View on Basescan
                  </a>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
