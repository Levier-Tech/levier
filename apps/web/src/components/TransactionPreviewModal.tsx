"use client";

import React from "react";
import {
  ArrowUpRight,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { PositionType } from "@levier/types";
import { TradeStep } from "../hooks/useLeverageTrade";

import { env } from "../env.mjs";

interface TransactionPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  assetSymbol: string;
  debtToken?: string;
  positionType: PositionType;
  collateralUsd: number;
  leverage: number;
  markPrice: number;
  estimatedLiquidationPrice: number;
  borrowApr: number;
  tradingFeeUsd: number;
  protocolFeeUsd: number;
  step?: TradeStep;
  txHash?: string | null;
  errorMessage?: string | null;
}

export function TransactionPreviewModal({
  isOpen,
  onClose,
  onConfirm,
  assetSymbol,
  debtToken = "USDG",
  positionType,
  collateralUsd,
  leverage,
  markPrice,
  estimatedLiquidationPrice,
  borrowApr,
  tradingFeeUsd,
  protocolFeeUsd,
  step = "IDLE",
  txHash,
  errorMessage,
}: TransactionPreviewModalProps) {
  if (!isOpen) return null;

  const totalExposure = collateralUsd * leverage;
  const borrowedAmount = Math.max(0, totalExposure - collateralUsd);

  const isExecuting =
    step === "APPROVING" || step === "EXECUTING" || step === "CONFIRMING";
  const isSuccess = step === "SUCCESS";
  const isError = step === "ERROR";

  const explorerUrl = txHash ? `${env.EXPLORER_URL}/tx/${txHash}` : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 font-sans">
      <div className="bg-surface w-full max-w-md rounded-sm p-6 border border-white/15 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div>
            <span className="text-[10px] text-muted uppercase tracking-widest block">
              [TRANSACTION PREVIEW — ROBINHOOD CHAIN]
            </span>
            <h3 className="text-base font-bold text-white font-sans uppercase">
              CONFIRM {positionType} ({leverage.toFixed(1)}X)
            </h3>
          </div>
          <button
            onClick={onClose}
            disabled={isExecuting}
            className="text-muted hover:text-white transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status Banner when Active */}
        {isExecuting && (
          <div className="bg-brand/10 border border-brand/30 p-4 rounded-sm flex items-center gap-3 text-xs">
            <Loader2 className="w-5 h-5 text-brand animate-spin shrink-0" />
            <div className="space-y-0.5">
              <div className="font-bold text-white">
                {step === "APPROVING" && "STEP 1/2: APPROVING COLLATERAL..."}
                {step === "EXECUTING" && "STEP 2/2: EXECUTING ROUTER ORDER..."}
                {step === "CONFIRMING" && "WAITING FOR BLOCK CONFIRMATION..."}
              </div>
              <div className="text-[10px] text-muted">
                Please sign the transaction prompt in your connected wallet.
              </div>
            </div>
          </div>
        )}

        {isSuccess && (
          <div className="bg-brand/15 border border-brand/40 p-4 rounded-sm space-y-2 text-xs">
            <div className="flex items-center gap-2 text-brand font-bold">
              <CheckCircle2 className="w-5 h-5" />
              <span>TRANSACTION CONFIRMED ON-CHAIN</span>
            </div>
            <p className="text-[10px] text-muted">
              Your {positionType} position has been executed and recorded.
            </p>
            {explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] text-brand hover:underline font-bold"
              >
                <span>VIEW ON ROBINHOOD EXPLORER</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        )}

        {isError && (
          <div className="bg-[#FF4D4D]/10 border border-[#FF4D4D]/30 p-4 rounded-sm space-y-1 text-xs">
            <div className="flex items-center gap-2 text-[#FF4D4D] font-bold">
              <AlertTriangle className="w-5 h-5" />
              <span>TRANSACTION REVERTED</span>
            </div>
            <p className="text-[10px] text-gray-400 break-all">
              {errorMessage ||
                "Execution was rejected or exceeded slippage limit."}
            </p>
          </div>
        )}

        {/* Economics Overview Grid */}
        <div className="bg-surface-subtle rounded-sm p-4 border border-white/10 space-y-3 font-sans text-xs uppercase tabular-nums">
          <div className="flex justify-between items-center text-muted">
            <span>COLLATERAL DEPOSIT</span>
            <span className="font-bold text-white">
              ${collateralUsd.toFixed(2)} {debtToken}
            </span>
          </div>
          <div className="flex justify-between items-center text-muted">
            <span>BORROWED DEBT</span>
            <span className="font-bold text-[#FFB800]">
              ${borrowedAmount.toFixed(2)} {debtToken}
            </span>
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-white/10 text-white font-bold">
            <span>TOTAL EXPOSURE</span>
            <span className="text-brand">
              ${totalExposure.toFixed(2)} {assetSymbol}
            </span>
          </div>
        </div>

        {/* Risk & Fees Breakdown */}
        <div className="space-y-2 text-xs font-sans uppercase tabular-nums">
          <div className="flex justify-between items-center py-1 border-b border-white/10">
            <span className="text-muted">ORACLE MARK PRICE</span>
            <span className="font-bold text-white">
              ${markPrice.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between items-center py-1 border-b border-white/10">
            <span className="text-muted">EST. LIQUIDATION PRICE</span>
            <span className="font-bold text-[#FF4D4D]">
              ${estimatedLiquidationPrice.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between items-center py-1 border-b border-white/10">
            <span className="text-muted">BORROW APR</span>
            <span className="font-bold text-[#FFB800]">
              {borrowApr.toFixed(2)}%
            </span>
          </div>
          <div className="flex justify-between items-center py-1">
            <span className="text-muted">EST. PROTOCOL & GAS FEES</span>
            <span className="font-bold text-white">
              ${(tradingFeeUsd + protocolFeeUsd).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Warning Badge */}
        <div className="bg-surface-subtle border border-white/10 p-3 rounded-sm text-[10px] text-muted font-sans uppercase leading-relaxed">
          [RISK WARNING] MARGIN POSITIONS ARE SUBJECT TO AUTOMATED DELEVERAGING
          AND LIQUIDATION IF LTV EXCEEDS MAXIMUM THRESHOLD.
        </div>

        {/* CTA Actions */}
        <div className="flex gap-3 pt-1 font-sans text-xs">
          <button
            onClick={onClose}
            disabled={isExecuting}
            className="w-1/3 py-3 bg-surface-subtle hover:bg-[#121412] text-muted hover:text-white font-bold rounded-sm border border-white/10 transition-all uppercase disabled:opacity-50"
          >
            {isSuccess ? "CLOSE" : "CANCEL"}
          </button>
          {!isSuccess && (
            <button
              onClick={onConfirm}
              disabled={isExecuting}
              className="w-2/3 py-3 bg-brand hover:bg-brand-hover disabled:bg-gray-700 text-white font-extrabold rounded-sm transition-all uppercase tracking-widest inline-flex items-center justify-center gap-2"
            >
              {isExecuting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>EXECUTING...</span>
                </>
              ) : (
                <>
                  <span>CONFIRM ON-CHAIN</span>
                  <ArrowUpRight className="w-4 h-4" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
