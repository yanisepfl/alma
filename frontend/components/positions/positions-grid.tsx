"use client";

import { motion } from "framer-motion";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { usePositionContext } from "@/hooks/use-position-context";
import { useDelegation } from "@/hooks/use-delegation";
import { QUIRKY_MESSAGES } from "@/lib/positions/constants";
import { PositionCard } from "./position-card";
import { DelegationStepper } from "@/components/delegation/delegation-stepper";

const PAGE_SIZE = 9;
const GRID_SLOTS = 9;

function formatTotalValue(
  positions: { metrics?: { positionSizeUSD: number } }[]
): string {
  const total = positions.reduce(
    (sum, p) => sum + (p.metrics?.positionSizeUSD ?? 0),
    0
  );
  if (total === 0) return "$0.00";
  if (total >= 1_000_000) return `$${(total / 1_000_000).toFixed(2)}M`;
  if (total >= 1_000) return `$${(total / 1_000).toFixed(2)}K`;
  return `$${total.toFixed(2)}`;
}

export function PositionsGrid() {
  const { positions, isLoading, selectPosition } = usePositionContext();
  const { status: delegationStatus } = useDelegation();
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState("");
  const [delegateOpen, setDelegateOpen] = useState(false);
  const isDelegated = delegationStatus === "delegated";

  useEffect(() => {
    const posCount = positions.length;
    const rebalanceCount = Math.floor(Math.random() * 4) + 1;
    setMessage(
      `I rebalanced ${posCount || 0} position${posCount !== 1 ? "s" : ""} ${rebalanceCount} time${rebalanceCount !== 1 ? "s" : ""} today!`
    );
  }, [positions.length]);

  const totalPages = Math.max(1, Math.ceil((positions.length + 1) / PAGE_SIZE));
  const startIdx = page * PAGE_SIZE;
  const pagePositions = positions.slice(startIdx, startIdx + PAGE_SIZE);
  const totalValue = formatTotalValue(positions);

  type Slot =
    | { type: "position"; position: (typeof positions)[0] }
    | { type: "plus" }
    | { type: "ghost" };

  const slots: Slot[] = [];
  for (let i = 0; i < GRID_SLOTS; i++) {
    if (i < pagePositions.length) {
      slots.push({ type: "position", position: pagePositions[i] });
    } else if (i === pagePositions.length) {
      slots.push({ type: "plus" });
    } else {
      slots.push({ type: "ghost" });
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 flex flex-col justify-center min-h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <motion.div
            animate={{ opacity: 1, scale: 1 }}
            initial={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="shrink-0"
          >
            <img src="/logo.png" alt="Alma" width={40} height={40} className="dark:invert" />
          </motion.div>
          <motion.p
            animate={{ opacity: 1, x: 0 }}
            initial={{ opacity: 0, x: -6 }}
            transition={{ delay: 0.15, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="text-3xl text-foreground font-[family-name:var(--font-serif)] leading-tight"
          >
            {message}
          </motion.p>
        </div>

        {positions.length > 0 && (
          <motion.div
            animate={{ opacity: 1 }}
            initial={{ opacity: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="flex items-center gap-3"
          >
            <div className="text-right mr-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
                Total Value
              </div>
              <div className="text-2xl font-semibold tracking-tight mt-0.5">
                {totalValue}
              </div>
            </div>

            {!isDelegated && (
              <button
                onClick={() => setDelegateOpen(true)}
                className="rounded-xl border border-border/50 bg-card/30 px-4 py-3 text-[13px] text-muted-foreground transition-all duration-200 cursor-pointer hover:-translate-y-0.5 hover:bg-muted/40 hover:text-foreground hover:shadow-[var(--shadow-card)]"
              >
                Delegate All
              </button>
            )}
          </motion.div>
        )}
      </div>

      {/* Loading state */}
      {isLoading && positions.length === 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(GRID_SLOTS)].map((_, i) => (
            <div key={i} className="h-[170px] rounded-xl border border-border/50 bg-card">
              <div className="flex h-full items-center justify-center">
                <div className="size-4 rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground/60 animate-spin" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Grid */}
      {(!isLoading || positions.length > 0) && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {slots.map((slot, i) => {
              if (slot.type === "position") {
                return (
                  <motion.div
                    key={slot.position.tokenId}
                    animate={{ opacity: 1, y: 0 }}
                    initial={{ opacity: 0, y: 8 }}
                    transition={{ delay: 0.04 * i, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <PositionCard position={slot.position} onClick={() => selectPosition(slot.position.tokenId)} />
                  </motion.div>
                );
              }

              if (slot.type === "plus") {
                return (
                  <motion.a
                    key="plus"
                    href="https://app.uniswap.org/positions/create/v4"
                    target="_blank"
                    rel="noopener noreferrer"
                    animate={{ opacity: 1, y: 0 }}
                    initial={{ opacity: 0, y: 8 }}
                    transition={{ delay: 0.04 * i, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    className="flex h-[170px] items-center justify-center rounded-xl border border-dashed border-border/50 bg-card/40 transition-colors hover:border-border hover:bg-card/60 cursor-pointer"
                  >
                    <PlusIcon className="size-5 text-muted-foreground/30" />
                  </motion.a>
                );
              }

              return (
                <div key={`ghost-${i}`} className="h-[170px] rounded-xl border border-border/25 bg-card/15" />
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-md p-1 text-muted-foreground/50 hover:text-foreground disabled:opacity-20 cursor-pointer transition-colors"
              >
                <ChevronLeftIcon className="size-4" />
              </button>
              <span className="text-xs text-muted-foreground/50">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className="rounded-md p-1 text-muted-foreground/50 hover:text-foreground disabled:opacity-20 cursor-pointer transition-colors"
              >
                <ChevronRightIcon className="size-4" />
              </button>
            </div>
          )}
        </>
      )}
      <DelegationStepper open={delegateOpen} onOpenChange={setDelegateOpen} mode={positions.map(p => p.tokenId)} />
    </div>
  );
}
