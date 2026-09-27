"use client";

import { env } from "../env.mjs";
import React, { useState } from "react";
import { ArrowUpRight, X, Loader2, CheckCircle2 } from "lucide-react";
import { AutoProtectConfig } from "@levera/types";
import { useNetworkMode } from "../hooks/useNetworkMode";
import { useAutoProtect } from "../hooks/useAutoProtect";

interface AutoProtectModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AutoProtectConfig;
  onSave: (config: AutoProtectConfig) => void;
  pairSymbol?: string;
}

export function AutoProtectModal({
  isOpen,
  onClose,
  config,
  onSave,
  pairSymbol = "NVDA",
}: AutoProtectModalProps) {
  const { networkMode } = useNetworkMode();
  const { saveRule, isSaving, txHash } = useAutoProtect(networkMode);

  const [isEnabled, setIsEnabled] = useState<boolean>(config.isEnabled);
  const [triggerLtv, setTriggerLtv] = useState<number>(
    config.triggerLtvPercent,
  );
  const [targetLtv, setTargetLtv] = useState<number>(config.targetLtvPercent);
  const [isDone, setIsDone] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleSave = async () => {
    try {
      if (isEnabled) {
        await saveRule(
          pairSymbol,
          triggerLtv,
          targetLtv,
          config.maxDeleverageUsd || 1000,
        );
      }
      onSave({
        isEnabled,
        triggerLtvPercent: triggerLtv,
        targetLtvPercent: targetLtv,
        maxDeleverageUsd: config.maxDeleverageUsd,
      });
      setIsDone(true);
      setTimeout(() => {
        setIsDone(false);
        onClose();
      }, 1200);
    } catch (err) {
      console.error("Failed to configure AutoProtect rule", err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 font-sans">
      <div className="bg-surface w-full max-w-md rounded-sm p-6 border border-white/15 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div>
            <span className="text-[10px] text-muted uppercase tracking-widest block">
              [AUTOMATED RISK GUARD — ROBINHOOD CHAIN]
            </span>
            <h3 className="text-base font-bold text-white font-sans uppercase">
              AUTO-PROTECT RULES
            </h3>
          </div>
          <button
            onClick={onClose}
            disabled={!env.TRADING_ENABLED || isSaving}
            className="text-muted hover:text-white transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toggle Switch */}
        <div className="flex items-center justify-between bg-surface-subtle p-4 rounded-sm border border-white/10">
          <div className="space-y-1 pr-4">
            <span className="text-xs font-bold text-white uppercase block">
              AUTO-DELEVERAGE KEEPER
            </span>
            <span className="text-[10px] text-muted uppercase leading-relaxed block">
              AUTOMATICALLY REPAY DEBT VIA SMART CONTRACT BEFORE LIQUIDATION.
            </span>
          </div>
          <button
            onClick={() => setIsEnabled(!isEnabled)}
            disabled={!env.TRADING_ENABLED || isSaving}
            className={`px-3 py-1.5 rounded-sm text-xs font-sans font-bold uppercase transition-all ${
              isEnabled
                ? "bg-brand text-white"
                : "bg-surface text-muted border border-white/10"
            }`}
          >
            {isEnabled ? "ACTIVE" : "OFF"}
          </button>
        </div>

        {/* Sliders */}
        {isEnabled && (
          <div className="space-y-5 pt-1 uppercase text-xs">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-muted">TRIGGER DELEVERAGE LTV</span>
                <span className="font-bold text-[#FFB800]">{triggerLtv}%</span>
              </div>
              <input
                type="range"
                min="45"
                max="75"
                value={triggerLtv}
                onChange={(e) => setTriggerLtv(Number(e.target.value))}
                disabled={!env.TRADING_ENABLED || isSaving}
                className="w-full accent-[#008000] bg-surface-subtle h-2 rounded-none cursor-pointer border border-white/10"
              />
              <span className="text-[10px] text-muted block">
                KEEPER EXECUTES DELEVERAGE WHEN LTV HITS {triggerLtv}%.
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-muted">RESTORED TARGET LTV</span>
                <span className="font-bold text-brand">{targetLtv}%</span>
              </div>
              <input
                type="range"
                min="30"
                max="60"
                value={targetLtv}
                onChange={(e) => setTargetLtv(Number(e.target.value))}
                disabled={!env.TRADING_ENABLED || isSaving}
                className="w-full accent-[#008000] bg-surface-subtle h-2 rounded-none cursor-pointer border border-white/10"
              />
              <span className="text-[10px] text-muted block">
                TARGET LTV POST-EXECUTION IS RESTORED TO {targetLtv}%.
              </span>
            </div>
          </div>
        )}

        {/* Feedback info */}
        {isDone && (
          <div className="bg-brand/15 border border-brand/40 p-3 rounded-sm text-xs text-brand flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>RULE CONFIGURED ON-CHAIN SUCCESSFULLY</span>
          </div>
        )}

        {/* CTA */}
        <button
          onClick={handleSave}
          disabled={!env.TRADING_ENABLED || isSaving}
          className="w-full py-3.5 bg-brand hover:bg-brand-hover disabled:bg-gray-700 text-white font-sans font-bold text-xs uppercase tracking-widest rounded-sm transition-all inline-flex items-center justify-center gap-2"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>SAVING ON-CHAIN...</span>
            </>
          ) : (
            <>
              <span>SAVE PROTECTION RULES</span>
              <ArrowUpRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
