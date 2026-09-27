"use client";

import React from "react";
import { ArrowUpRight } from "lucide-react";
import { PortfolioSummary as PortfolioSummaryType } from "@levier/types";

interface PortfolioSummaryProps {
  summary: PortfolioSummaryType;
  onOpenAutoProtect: () => void;
  isLoading?: boolean;
}

export function PortfolioSummary({
  summary,
  onOpenAutoProtect,
  isLoading,
}: PortfolioSummaryProps) {
  if (isLoading) {
    return (
      <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-sans">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="bg-surface border border-white/10 p-5 rounded-sm space-y-3 animate-pulse"
          >
            <div className="h-3 w-32 bg-white/10 rounded-xs" />
            <div className="h-7 w-28 bg-white/15 rounded-xs" />
            <div className="h-3 w-20 bg-white/5 rounded-xs" />
          </div>
        ))}
      </div>
    );
  }

  const getHealthBadge = (health: number) => {
    if (health >= 1.5) {
      return {
        label: "HEALTHY",
        color: "bg-surface-subtle text-brand border-white/10",
      };
    } else if (health >= 1.2) {
      return {
        label: "CAUTION",
        color: "bg-surface-subtle text-[#FFB800] border-white/10",
      };
    } else {
      return {
        label: "AT RISK",
        color: "bg-surface-subtle text-[#FF4D4D] border-white/10",
      };
    }
  };

  const healthBadge = getHealthBadge(summary.healthFactor);

  return (
    <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-sans tabular-nums uppercase">
      {/* Net Equity Card */}
      <div className="bg-surface border border-white/10 p-5 rounded-sm space-y-2">
        <span className="text-xs text-muted block">NET ACCOUNT EQUITY</span>
        <div className="text-2xl font-bold text-white font-sans">
          $
          {summary.netEquityUsd.toLocaleString("en-US", {
            minimumFractionDigits: 2,
          })}
        </div>
        <span className="text-xs text-brand block font-semibold">
          24H PNL: +${summary.pnl24hUsd.toFixed(2)}
        </span>
      </div>

      {/* Borrowing Power */}
      <div className="bg-surface border border-white/10 p-5 rounded-sm space-y-2">
        <span className="text-xs text-muted block">BORROWING POWER</span>
        <div className="text-2xl font-bold text-white font-sans">
          $
          {summary.borrowingPowerUsd.toLocaleString("en-US", {
            minimumFractionDigits: 2,
          })}
        </div>
        <span className="text-xs text-muted block">
          WEIGHTED LTV: {summary.weightedLtvPercent.toFixed(1)}%
        </span>
      </div>

      {/* Account Health Factor Gauge */}
      <div className="bg-surface border border-white/10 p-5 rounded-sm space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">ACCOUNT HEALTH</span>
          <span
            className={`px-2 py-0.5 rounded-sm text-[10px] font-bold border ${healthBadge.color}`}
          >
            {healthBadge.label}
          </span>
        </div>
        <div className="text-2xl font-bold text-brand font-sans">
          {summary.healthFactor.toFixed(2)}
        </div>
        <span className="text-xs text-muted block">
          LIQUIDATION TRIGGER: &lt; 1.00
        </span>
      </div>

      {/* Auto-Protect Status */}
      <div className="bg-surface border border-white/10 p-5 rounded-sm flex flex-col justify-between space-y-2">
        <div>
          <span className="text-xs text-muted block">AUTO-PROTECT GUARD</span>
          <span className="text-xs font-bold text-white block mt-0.5">
            ACTIVE KEEPER MONITOR
          </span>
        </div>
        <button
          onClick={onOpenAutoProtect}
          className="w-full py-2 bg-surface-subtle hover:bg-brand hover:text-white text-white border border-white/10 rounded-sm text-xs font-bold uppercase transition-all inline-flex items-center justify-center gap-1.5"
        >
          <span>CONFIGURE RULES</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
