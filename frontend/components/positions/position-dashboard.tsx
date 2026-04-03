"use client";

import { motion } from "framer-motion";
import {
  ArrowRightLeftIcon,
  CoinsIcon,
  HandCoinsIcon,
  InfoIcon,
  TrendingUpIcon,
  ZapIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { EnrichedPosition } from "@/lib/positions/types";
import { QUIRKY_MESSAGES } from "@/lib/positions/constants";
import { formatLiquidity } from "@/lib/positions/utils";
import { cn } from "@/lib/utils";
import { StatCard, TickRangeVisual } from "./stat-card";

export function PositionDashboard({
  position,
  onSuggestedAction,
}: {
  position: EnrichedPosition;
  onSuggestedAction?: (text: string) => void;
}) {
  const [message, setMessage] = useState("");

  useEffect(() => {
    setMessage(
      QUIRKY_MESSAGES[Math.floor(Math.random() * QUIRKY_MESSAGES.length)]
    );
  }, [position.tokenId]);

  const actions = [
    {
      text: "Rebalance my position",
      icon: ArrowRightLeftIcon,
      isAction: true,
    },
    {
      text: "Claim fees and compound",
      icon: HandCoinsIcon,
      isAction: true,
    },
    {
      text: "What's my estimated APY?",
      icon: TrendingUpIcon,
      isAction: false,
    },
    {
      text: "Explain my impermanent loss",
      icon: InfoIcon,
      isAction: false,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      {/* Header: logo + quirky message */}
      <div className="flex items-center gap-4 mb-6">
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          initial={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="shrink-0"
        >
          <img
            src="/logo.png"
            alt="Alma"
            width={40}
            height={40}
            className="dark:invert"
          />
        </motion.div>
        <motion.p
          animate={{ opacity: 1, x: 0 }}
          initial={{ opacity: 0, x: -6 }}
          transition={{
            delay: 0.15,
            duration: 0.4,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="text-3xl text-foreground font-[family-name:var(--font-serif)] leading-tight"
        >
          {message}
        </motion.p>
      </div>

      {/* Position title + status */}
      <div className="flex items-center gap-3 mb-5">
        <h2 className="text-lg font-semibold tracking-tight">
          {position.token0Symbol} / {position.token1Symbol}
        </h2>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "size-2 rounded-full animate-pulse",
              position.isInRange
                ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]"
                : "bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.7)]"
            )}
          />
          <span
            className={cn(
              "text-xs font-medium",
              position.isInRange
                ? "text-emerald-500"
                : "text-red-400"
            )}
          >
            {position.isInRange ? "In Range" : "Out of Range"}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/40">
          #{position.tokenId}
        </span>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        <TickRangeVisual
          tickLower={position.tickLower}
          tickUpper={position.tickUpper}
          currentTick={position.pool.currentTick}
        />

        <StatCard
          label="Position Size"
          value={formatLiquidity(position.liquidity)}
        />

        <StatCard
          label="TVL"
          value="—"
          sub="Connect to fetch prices"
        />

        <StatCard
          label="Fee"
          value={`${(position.poolKey.fee / 10000).toFixed(2)}%`}
          sub={`Spacing: ${position.poolKey.tickSpacing}`}
        />

        <StatCard label="Fees Earned" value="—" sub="Pending calculation" />

        <StatCard label="APY (est.)" value="—" sub="Based on 7d volume" />
      </div>

      {/* Suggested actions — differentiate actions vs questions */}
      <div className="grid grid-cols-2 gap-2.5">
        {actions.map((action, i) => (
          <motion.button
            key={action.text}
            animate={{ opacity: 1, y: 0 }}
            initial={{ opacity: 0, y: 8 }}
            transition={{
              delay: 0.05 * i,
              duration: 0.3,
              ease: [0.22, 1, 0.36, 1],
            }}
            onClick={() => onSuggestedAction?.(action.text)}
            className={cn(
              "flex items-center gap-2.5 rounded-xl border px-4 py-3 text-left text-[13px] transition-all duration-150 cursor-pointer",
              action.isAction
                ? "border-foreground/15 bg-foreground/[0.03] text-foreground/80 hover:bg-foreground/[0.07] hover:text-foreground"
                : "border-border/40 bg-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground"
            )}
          >
            <action.icon className="size-3.5 shrink-0 opacity-50" />
            <span>{action.text}</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
