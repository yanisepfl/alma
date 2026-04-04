"use client";

import { motion } from "framer-motion";
import {
  ArrowRightLeftIcon,
  HandCoinsIcon,
  InfoIcon,
  ShieldCheckIcon,
  TrendingUpIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { EnrichedPosition } from "@/lib/positions/types";
import { QUIRKY_MESSAGES } from "@/lib/positions/constants";
import { cn } from "@/lib/utils";
import { StatCard, TickRangeVisual } from "./stat-card";
import { DelegationStepper } from "@/components/delegation/delegation-stepper";

function formatUSD(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value > 0) return `$${value.toFixed(4)}`;
  return "$0.00";
}

export function PositionDashboard({
  position,
  onSuggestedAction,
}: {
  position: EnrichedPosition;
  onSuggestedAction?: (text: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [delegateOpen, setDelegateOpen] = useState(false);
  const m = position.metrics;

  useEffect(() => {
    setMessage(
      QUIRKY_MESSAGES[Math.floor(Math.random() * QUIRKY_MESSAGES.length)]
    );
  }, [position.tokenId]);

  const actions = [
    {
      text: "Delegate to ALMA",
      icon: ShieldCheckIcon,
      isAction: true,
      isDelegation: true,
    },
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
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <circle
              cx="4" cy="4" r="4" fill="currentColor" fillOpacity="0.4"
              className={position.isInRange ? "text-green-500" : "text-red-500"}
            />
            <circle
              cx="4" cy="4" r="2" fill="currentColor"
              className={position.isInRange ? "text-green-500" : "text-red-500"}
            />
          </svg>
          <span
            className={cn(
              "text-xs font-medium",
              position.isInRange ? "text-green-500" : "text-red-400"
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
          minPrice={m?.minPrice}
          maxPrice={m?.maxPrice}
          currentPrice={m?.currentPrice}
        />

        <StatCard
          label="Position Size"
          value={m ? formatUSD(m.positionSizeUSD) : "Loading..."}
          sub={
            m
              ? `${parseFloat(m.amount0).toFixed(4)} ${position.token0Symbol} + ${parseFloat(m.amount1).toFixed(4)} ${position.token1Symbol}`
              : undefined
          }
        />

        <StatCard
          label="Fees Earned"
          value={m ? formatUSD(m.feesEarnedUSD) : "Loading..."}
          sub={
            m
              ? `${parseFloat(m.fee0).toFixed(6)} ${position.token0Symbol} + ${parseFloat(m.fee1).toFixed(6)} ${position.token1Symbol}`
              : undefined
          }
        />

        <StatCard
          label="Fee"
          value={m?.feePercent ?? "Loading..."}
        />

        <StatCard
          label="Current Price"
          value={m ? `${parseFloat(m.currentPrice).toFixed(6)}` : "Loading..."}
          sub={m ? `${position.token1Symbol} per ${position.token0Symbol}` : undefined}
        />

        <StatCard
          label="APY (est.)"
          value={
            m?.apyEstimate != null
              ? `${m.apyEstimate.toFixed(2)}%`
              : m
                ? "—"
                : "Loading..."
          }
          sub={m?.apyEstimate != null ? "Based on accumulated fees" : undefined}
        />
      </div>

      {/* Suggested actions */}
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
            onClick={() => {
              if (action.isDelegation) {
                setDelegateOpen(true);
              } else {
                onSuggestedAction?.(action.text);
              }
            }}
            className={cn(
              "flex items-center gap-2.5 rounded-xl border px-4 py-3 text-left text-[13px] transition-all duration-150 cursor-pointer",
              action.isDelegation
                ? "border-green-500/20 bg-green-500/[0.04] text-green-600 dark:text-green-400 hover:bg-green-500/[0.08] hover:border-green-500/30 col-span-2"
                : action.isAction
                  ? "border-foreground/15 bg-foreground/[0.03] text-foreground/80 hover:bg-foreground/[0.07] hover:text-foreground"
                  : "border-border/40 bg-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground"
            )}
          >
            <action.icon className="size-3.5 shrink-0 opacity-50" />
            <span>{action.text}</span>
          </motion.button>
        ))}
      </div>

      <DelegationStepper
        open={delegateOpen}
        onOpenChange={setDelegateOpen}
        mode={[position.tokenId]}
      />
    </div>
  );
}
