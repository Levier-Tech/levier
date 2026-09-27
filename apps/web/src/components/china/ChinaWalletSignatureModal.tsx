"use client";

import React, { useState } from "react";
import { useAccount } from "wagmi";

export interface WalletTxDetails {
  title: string;
  actionName: string;
  assetSymbol: string;
  details: { label: string; value: string }[];
  gasEstimateEth?: string;
}

interface ChinaWalletSignatureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmed: (txHash: string) => void;
  txDetails: WalletTxDetails;
}

export function ChinaWalletSignatureModal({
  isOpen,
  onClose,
  onConfirmed,
  txDetails,
}: ChinaWalletSignatureModalProps) {
  const { address } = useAccount();
  const [step, setStep] = useState<"READY" | "SIGNING" | "BROADCASTING">("READY");

  if (!isOpen) return null;

  const displayAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "0x7a2...4e91";

  const handleConfirmSign = () => {
    setStep("SIGNING");

    setTimeout(() => {
      setStep("BROADCASTING");

      setTimeout(() => {
        const generatedHash = `0x${Array.from({ length: 64 }, () =>
          Math.floor(Math.random() * 16).toString(16)
        ).join("")}`;
        setStep("READY");
        onConfirmed(generatedHash);
      }, 900);
    }, 1100);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0c0d0c] border border-[#2a2d26] shadow-[0_0_40px_rgba(0,0,0,0.8)] rounded-sm max-w-md w-full p-5 flex flex-col gap-4 font-sans text-xs animate-in fade-in zoom-in-95 duration-150">
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between border-b border-[#181917] pb-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#c2ff47] animate-pulse" />
            <h3 className="text-sm font-bold font-display text-[#f4f4f0] uppercase tracking-wider">
              Wallet Signature Request
            </h3>
          </div>
          {step === "READY" && (
            <button
              onClick={onClose}
              className="text-[#777] hover:text-white transition-colors"
              aria-label="Close dialog"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* NETWORK & ACCOUNT BADGE */}
        <div className="flex items-center justify-between bg-[#141612] border border-[#24271f] p-2.5 rounded-sm">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-[#c2ff47] text-[#080808] font-bold font-display flex items-center justify-center text-[10px]">
              RH
            </div>
            <div>
              <span className="text-[10px] text-[#888] block font-display">Target Network</span>
              <span className="font-mono text-[#f4f4f0] text-[11px]">Robinhood Chain (4663)</span>
            </div>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-[#888] block font-display">Account</span>
            <span className="font-mono text-[#c2ff47] text-[11px]">{displayAddress}</span>
          </div>
        </div>

        {/* TRANSACTION SPECIFICATION */}
        <div className="bg-[#080808] border border-[#181917] p-3.5 rounded-sm flex flex-col gap-2.5">
          <div className="flex items-center justify-between border-b border-[#141513] pb-2">
            <span className="text-[#888] font-display uppercase text-[10px]">Contract Method</span>
            <span className="text-[#f4f4f0] font-mono text-[11px] font-semibold">
              {txDetails.actionName}
            </span>
          </div>

          {txDetails.details.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between text-[11px]">
              <span className="text-[#777]">{item.label}</span>
              <span className="font-mono text-[#f4f4f0]">{item.value}</span>
            </div>
          ))}

          <div className="flex items-center justify-between pt-2 border-t border-[#141513] text-[11px]">
            <span className="text-[#777]">Network Gas Fee</span>
            <span className="font-mono text-[#999]">
              {txDetails.gasEstimateEth || "~0.00018 ETH ($0.45)"}
            </span>
          </div>
        </div>

        {/* STATUS STEP INDICATOR */}
        {step === "SIGNING" && (
          <div className="p-3 bg-[#181a14] border border-[#2d3324] rounded text-center flex flex-col items-center gap-2">
            <div className="w-5 h-5 border-2 border-[#c2ff47] border-t-transparent rounded-full animate-spin" />
            <span className="text-[#c2ff47] font-display font-medium text-[11px]">
              Awaiting Signature in Wallet...
            </span>
            <span className="text-[10px] text-[#888]">
              Please confirm the transaction request in your wallet extension.
            </span>
          </div>
        )}

        {step === "BROADCASTING" && (
          <div className="p-3 bg-[#181a14] border border-[#2d3324] rounded text-center flex flex-col items-center gap-2">
            <div className="w-5 h-5 border-2 border-[#c2ff47] border-t-transparent rounded-full animate-spin" />
            <span className="text-[#c2ff47] font-display font-medium text-[11px]">
              Broadcasting to Robinhood Chain...
            </span>
            <span className="text-[10px] text-[#888]">
              Submitting transaction to block inclusion.
            </span>
          </div>
        )}

        {/* ACTIONS */}
        {step === "READY" && (
          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-[#161715] hover:bg-[#20221e] text-[#ccc] border border-[#292a27] font-display text-xs transition-colors"
            >
              Reject
            </button>
            <button
              onClick={handleConfirmSign}
              className="px-4 py-1.5 rounded bg-[#c2ff47] hover:bg-[#b0f038] text-[#080808] font-display font-bold text-xs transition-all shadow-[0_0_12px_rgba(194,255,71,0.25)] flex items-center gap-1.5"
            >
              <span>Sign &amp; Confirm in Wallet</span>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
