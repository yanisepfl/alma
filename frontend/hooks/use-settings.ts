"use client";

import { useState, useEffect, useCallback } from "react";
import { API_URL } from "@/lib/delegation/constants";

export type RiskProfile = "low" | "medium" | "high";

export interface AlmaSettings {
  riskProfile: RiskProfile;
  maxSlippage: number; // in bps, e.g. 50 = 0.5%
  autoRebalance: boolean;
}

const STORAGE_KEY = "alma-settings";

const DEFAULTS: AlmaSettings = {
  riskProfile: "medium",
  maxSlippage: 50,
  autoRebalance: true,
};

function load(): AlmaSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

/** Send settings to the backend so the rebalancer uses them */
export async function syncSettingsToBackend(
  address: string,
  settings: AlmaSettings
): Promise<void> {
  try {
    await fetch(`${API_URL}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, settings }),
    });
  } catch (e) {
    console.warn("[settings] Failed to sync to backend:", e);
  }
}

export function useSettings(walletAddress?: string) {
  const [settings, setSettings] = useState<AlmaSettings>(DEFAULTS);

  useEffect(() => {
    setSettings(load());
  }, []);

  const update = useCallback(
    (patch: Partial<AlmaSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        // Sync to backend if wallet address is available
        if (walletAddress) {
          syncSettingsToBackend(walletAddress, next);
        }
        return next;
      });
    },
    [walletAddress]
  );

  return { settings, update };
}

/** Range width multiplier based on risk profile (half-width = tickSpacing * multiplier) */
export function getRangeMultiplier(risk: RiskProfile): number {
  switch (risk) {
    case "low": return 30;    // +/- 20% range
    case "medium": return 16; // +/- 10% range
    case "high": return 2;    // +/- 1% range
  }
}
