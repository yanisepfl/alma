"use client";

import { IconRefreshClockwise, IconCheck, IconCircleInfo } from "nucleo-micro-bold-essential";
import Image from "next/image";
import { useEffect, useState } from "react";
import { usePositionContext } from "@/hooks/use-position-context";

const AGENT_API = process.env.NEXT_PUBLIC_AGENT_API ?? "http://localhost:3001";

interface AgentAction {
  id: string;
  type: "rebalance" | "claim" | "monitor";
  status: "completed" | "pending" | "evaluating";
  summary: string;
  timestamp: string;
  tokenId?: string;
}

const FALLBACK_ACTIONS: AgentAction[] = [
  {
    id: "1",
    type: "rebalance",
    status: "completed",
    summary: "Rebalanced ETH/USDC — moved range to 2,410–2,580",
    timestamp: new Date(Date.now() - 3600_000).toISOString(),
  },
  {
    id: "2",
    type: "monitor",
    status: "evaluating",
    summary: "Checking cbBTC/USDC — 3% out of range",
    timestamp: new Date(Date.now() - 900_000).toISOString(),
  },
];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
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
};

export function AppSidebar() {
  const { clearSelection } = usePositionContext();
  const [actions, setActions] = useState<AgentAction[]>(FALLBACK_ACTIONS);

  // Fetch actions from backend, poll every 30s
  useEffect(() => {
    const fetchActions = () => {
      fetch(`${AGENT_API}/api/actions`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data?.actions) setActions(data.actions.length > 0 ? data.actions : FALLBACK_ACTIONS);
        })
        .catch(() => {});
    };
    fetchActions();
    const interval = setInterval(fetchActions, 30_000);
    return () => clearInterval(interval);
  }, []);

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
          <span className="text-lg font-[family-name:var(--font-serif)] text-sidebar-foreground">
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
        {actions.map((action) => {
          const Icon = action.type === "rebalance" ? IconRefreshClockwise : STATUS_ICON[action.status];
          const titles: Record<string, string> = {
            rebalance: "Rebalance",
            claim: "Claim Fees",
            monitor: "Monitoring",
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
                <span className="ml-auto text-[9px] text-muted-foreground/40">
                  {timeAgo(action.timestamp)}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground/70 leading-snug">
                {action.summary}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
