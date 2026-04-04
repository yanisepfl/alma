"use client";

import { IconRefreshClockwise, IconCheck, IconCircleInfo } from "nucleo-micro-bold-essential";
import Image from "next/image";
import { useEffect, useState } from "react";
import { usePositionContext } from "@/hooks/use-position-context";
import { useAccount } from "wagmi";

const AGENT_API = process.env.NEXT_PUBLIC_AGENT_API ?? "http://localhost:3001";

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
    const fetchActions = () => {
      const params = new URLSearchParams({ limit: "15" });
      if (address) params.set("address", address);
      fetch(`${AGENT_API}/api/actions?${params}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          // Handle both array and {actions:[]} formats
          const arr = Array.isArray(data) ? data : data?.actions;
          if (Array.isArray(arr) && arr.length > 0) setActions(arr);
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
        {actions.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-[11px] text-muted-foreground/40">
            No actions yet
          </div>
        ) : (
          actions.map((action) => {
            const Icon = action.type === "rebalance" ? IconRefreshClockwise : STATUS_ICON[action.status] || IconCircleInfo;
            const titles: Record<string, string> = {
              rebalance: "Rebalance",
              claim: "Claim Fees",
              monitor: "Monitoring",
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
                  {action.summary}
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
