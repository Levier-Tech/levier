"use client";

import { env } from "../env.mjs";
import React, { useState } from "react";
import { ArrowUpRight, X, Loader2, CheckCircle2 } from "lucide-react";
import { VaultConfig } from "@levera/types";
import { AssetLogo } from "./AssetLogo";
import { useNetworkMode } from "../hooks/useNetworkMode";
import { useVaultDeposit } from "../hooks/useVaultDeposit";

interface VaultCardProps {
  vault: VaultConfig;
}

export function VaultCardSkeleton() {
  return (
    <div className="bg-surface border border-white/10 p-6 rounded-sm space-y-6 w-full font-sans animate-pulse">
      {/* Header Shimmer */}
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white/10" />
          <div className="space-y-1.5">
            <div className="h-4 w-32 bg-white/10 rounded-xs" />
            <div className="h-3 w-24 bg-white/5 rounded-xs" />
          </div>
        </div>
        <div className="h-5 w-20 bg-white/10 rounded-xs" />
      </div>

      {/* APY Box */}
      <div className="bg-surface-subtle p-4 rounded-xs border border-white/5 flex justify-between items-end">
        <div className="space-y-2">
          <div className="h-3 w-24 bg-white/5 rounded-xs" />
          <div className="h-8 w-28 bg-brand/20 rounded-xs" />
        </div>
        <div className="h-3 w-20 bg-white/5 rounded-xs" />
      </div>

      {/* Metrics */}
      <div className="space-y-3 border-b border-white/10 pb-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex justify-between">
            <div className="h-3 w-28 bg-white/5 rounded-xs" />
            <div className="h-3 w-20 bg-white/10 rounded-xs" />
          </div>
        ))}
      </div>

      {/* Action Button */}
      <div className="h-11 w-full bg-brand/20 rounded-xs" />
    </div>
  );
}

export function VaultCard({ vault }: VaultCardProps) {
  const { networkMode } = useNetworkMode();
  const { depositLiquidity, isProcessing, txHash } =
    useVaultDeposit(networkMode);

  const [amount, setAmount] = useState<string>("");
  const [activeModalTab, setActiveModalTab] = useState<"DEPOSIT" | "WITHDRAW">(
    "DEPOSIT",
  );
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isDone, setIsDone] = useState<boolean>(false);

  const assetName = vault.assetSymbol || "USDG";

  const handleAction = async () => {
    const numericAmount = parseFloat(amount) || 0;
    if (numericAmount <= 0) return;

    try {
      if (activeModalTab === "DEPOSIT") {
        await depositLiquidity(numericAmount);
        setIsDone(true);
        setTimeout(() => {
          setIsDone(false);
          setIsModalOpen(false);
          setAmount("");
        }, 1500);
      }
    } catch (err) {
      // Keep provider details out of user-visible logs.
    }
  };

  return (
    <div className="bg-surface border border-white/10 p-6 rounded-sm space-y-6 w-full font-sans">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <AssetLogo symbol={assetName} size="md" />
          <div>
            <h3 className="text-base font-bold text-white font-sans uppercase">
              {vault.name}
            </h3>
            <span className="text-xs text-muted">
              {assetName} · ERC-4626 vault
            </span>
          </div>
        </div>
        <span className="px-2.5 py-0.5 rounded-sm text-[10px] font-bold bg-surface-subtle text-brand border border-white/10 uppercase">
          {vault.riskTier} RISK
        </span>
      </div>

      {/* Primary APY Stats */}
      <div className="bg-surface-subtle rounded-sm p-4 border border-white/10 flex justify-between items-center tabular-nums">
        <div>
          <span className="text-xs text-muted uppercase block">
            NET LENDING APY
          </span>
          <span className="text-3xl font-bold text-brand font-sans">
            +{Number(vault.apy || 0).toFixed(2)}%
          </span>
        </div>
        <div className="text-right">
          <span className="text-xs text-muted uppercase block">VAULT TVL</span>
          <span className="text-lg font-bold text-white font-sans">
            ${((vault.tvlUsd || 0) / 1000000).toFixed(2)}M
          </span>
        </div>
      </div>

      {/* Asset Allocation Breakdown */}
      <div className="space-y-2 uppercase text-xs">
        <div className="flex justify-between items-center text-muted">
          <span>STRATEGY ALLOCATION</span>
          <span>ROBINHOOD CHAIN</span>
        </div>

        {/* Progress Bar */}
        <div className="h-1.5 w-full bg-surface-subtle rounded-none overflow-hidden flex border border-white/10">
          <div
            style={{ width: "35%" }}
            className="bg-brand h-full"
            title="NVDA 35%"
          />
          <div
            style={{ width: "30%" }}
            className="bg-blue-500 h-full"
            title="AAPL 30%"
          />
          <div
            style={{ width: "20%" }}
            className="bg-indigo-500 h-full"
            title="SPY 20%"
          />
          <div
            style={{ width: "15%" }}
            className="bg-amber-500 h-full"
            title="TSLA 15%"
          />
        </div>

        <p className="text-[10px] text-muted leading-relaxed pt-1">
          {vault.description ||
            "Supplies stablecoin liquidity dynamically across verified isolated pairs."}
        </p>
      </div>

      {/* Actions */}
      <button
        disabled={!env.TRADING_ENABLED}
        onClick={() => setIsModalOpen(true)}
        className="w-full py-3 bg-brand hover:bg-brand-hover text-white font-bold text-xs uppercase tracking-widest rounded-sm transition-all inline-flex items-center justify-center gap-2"
      >
        <span>DEPOSIT CAPITAL</span>
        <ArrowUpRight className="w-4 h-4" />
      </button>

      {!env.TRADING_ENABLED && (
        <p className="app-note" role="status">
          Vault deposits and withdrawals are not enabled yet. No wallet approval
          is needed while this feature is unavailable.
        </p>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-surface border border-white/15 w-full max-w-md rounded-sm p-6 space-y-4 font-sans">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h4 className="text-sm font-bold text-white uppercase font-sans">
                VAULT LIQUIDITY ({vault.name})
              </h4>
              <button
                onClick={() => setIsModalOpen(false)}
                disabled={isProcessing}
                className="text-muted hover:text-white transition-colors disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 bg-surface-subtle p-1 border border-white/10 text-xs font-bold uppercase">
              <button
                onClick={() => setActiveModalTab("DEPOSIT")}
                className={`py-2 rounded-sm ${
                  activeModalTab === "DEPOSIT"
                    ? "bg-brand text-white"
                    : "text-muted"
                }`}
              >
                DEPOSIT
              </button>
              <button
                onClick={() => setActiveModalTab("WITHDRAW")}
                className={`py-2 rounded-sm ${
                  activeModalTab === "WITHDRAW"
                    ? "bg-white text-[#050505]"
                    : "text-muted"
                }`}
              >
                WITHDRAW
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <label className="text-muted uppercase">
                AMOUNT ({assetName})
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                disabled={isProcessing}
                className="w-full bg-surface-subtle border border-white/15 rounded-sm p-3 text-white font-sans text-sm outline-none"
              />
            </div>

            {isDone && (
              <div className="bg-brand/15 border border-brand/40 p-3 rounded-sm text-xs text-brand flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>DEPOSIT CONFIRMED ON-CHAIN</span>
              </div>
            )}

            <button
              onClick={handleAction}
              disabled={
                !env.TRADING_ENABLED ||
                isProcessing ||
                !amount ||
                parseFloat(amount) <= 0
              }
              className="w-full py-3 bg-brand hover:bg-brand-hover disabled:bg-gray-700 text-white font-bold text-xs uppercase tracking-widest rounded-sm transition-all inline-flex items-center justify-center gap-2"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>PROCESSING ON-CHAIN...</span>
                </>
              ) : (
                <span>CONFIRM {activeModalTab}</span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
