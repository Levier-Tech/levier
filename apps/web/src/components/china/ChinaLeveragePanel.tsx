"use client";

import React, { useState, useMemo } from "react";
import {
  type ChineseEquityAsset,
  type ChineseEquityMarket,
  type ChineseEquityPosition,
  calculateHealthFactor,
  calculateLiquidationPrice,
  formatCurrency,
  loadStoredChinesePositions,
} from "../../lib/chinese-equities-client";
import { ChinaWalletSignatureModal } from "./ChinaWalletSignatureModal";
import { ChinaAssetLogo } from "./ChinaAssetLogo";

export function ChinaLeveragePanel({
  asset,
  market,
  onPositionOpened,
}: {
  asset: ChineseEquityAsset;
  market?: ChineseEquityMarket;
  onPositionOpened?: (newPos: ChineseEquityPosition) => void;
}) {
  const [direction, setDirection] = useState<"LONG" | "SHORT">("LONG");
  const [marginUsd, setMarginUsd] = useState<string>("150");
  const [leverage, setLeverage] = useState<number>(2.0);
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [confirmedTxHash, setConfirmedTxHash] = useState<string | null>(null);
  const [executedPosition, setExecutedPosition] = useState<ChineseEquityPosition | null>(null);

  const activeStoredPosition = useMemo(() => {
    if (typeof window === "undefined") return null;
    const stored = loadStoredChinesePositions();
    return (
      stored.find(
        (p) =>
          p.assetSymbol.toUpperCase() === asset.ticker.toUpperCase() &&
          p.positionType === "LONG"
      ) || null
    );
  }, [asset.ticker, confirmedTxHash]);

  const tokenPrice = market?.tokenReferencePriceUsd ?? 85.0;
  const maxLeverage = market?.maxLeverage ?? 2.0;
  const liquidationThreshold = market?.liquidationThreshold ?? 45.0;
  const isMarketOpen = market?.marketSession === "REGULAR" || market?.marketSession === "PRE_MARKET";
  const isLongEnabled = market?.capabilities.long ?? false;

  // Numerical inputs & derived calculations
  const numMargin = parseFloat(marginUsd) || 0;
  const totalExposureUsd = numMargin * leverage;
  const borrowedUsdg = totalExposureUsd - numMargin;
  const tokensAcquired = tokenPrice > 0 ? totalExposureUsd / tokenPrice : 0;

  // Health Factor & Liquidation Price
  const estimatedHf = calculateHealthFactor(totalExposureUsd, liquidationThreshold, borrowedUsdg);
  const estimatedLiqPrice = calculateLiquidationPrice(borrowedUsdg, tokensAcquired, liquidationThreshold);

  // Daily borrow interest
  const borrowApr = market?.borrowApr ?? 7.8;
  const dailyInterestUsd = (borrowedUsdg * (borrowApr / 100)) / 365;

  const handleOpenModal = () => {
    if (numMargin <= 0) return;
    setIsSignatureModalOpen(true);
  };

  const handleWalletConfirmed = (txHash: string) => {
    setConfirmedTxHash(txHash);
    setIsSignatureModalOpen(false);

    if (onPositionOpened) {
      const newPos: ChineseEquityPosition = {
        id: `pos-${asset.ticker.toLowerCase()}-${Date.now().toString().slice(-4)}`,
        marketId: market?.marketId ?? null,
        assetSymbol: asset.ticker,
        name: `${asset.ticker} / USDG`,
        positionType: "LONG",
        leverage,
        collateralTokens: Number(tokensAcquired.toFixed(4)),
        collateralUsd: Number(totalExposureUsd.toFixed(2)),
        debtUsd: Number(borrowedUsdg.toFixed(2)),
        equityUsd: Number(numMargin.toFixed(2)),
        entryPrice: Number(tokenPrice.toFixed(2)),
        markPrice: Number(tokenPrice.toFixed(2)),
        liquidationPrice: Number(estimatedLiqPrice.toFixed(2)),
        healthFactor: Number(estimatedHf.toFixed(2)),
        currentLtv: Number(((borrowedUsdg / totalExposureUsd) * 100).toFixed(2)),
        liquidationThreshold,
        pnlUsd: 0,
        pnlPercent: 0,
        accruedInterestUsd: 0,
        openedAt: new Date().toISOString(),
        status: estimatedHf < 1.0 ? "CRITICAL" : estimatedHf < 1.3 ? "WARNING" : "HEALTHY",
        riskTier: market?.riskTier ?? "Tier A",
      };
      setExecutedPosition(newPos);
      onPositionOpened(newPos);
    }
  };

  return (
    <div className="w-full bg-[#0c0d0c] border border-[#1f201d] p-4 sm:p-5 rounded-sm font-sans box-border overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-2 pb-3.5 mb-4 border-b border-[#181917]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-[#777] uppercase font-display tracking-wider truncate">
            Spot-Backed Leverage · Isolated
          </span>
          <span className="text-[10px] font-mono text-[#888] shrink-0">
            {asset.ticker}: <strong className="text-[#f4f4f0]">${tokenPrice.toFixed(2)}</strong>
          </span>
        </div>
        <div className="flex items-center gap-2.5 min-w-0">
          <ChinaAssetLogo symbol={asset.ticker} size="md" />
          <h3 className="text-base font-bold font-display text-[#f4f4f0] truncate">
            {direction === "LONG"
              ? `Leveraged Long ${asset.ticker} (Up to ${maxLeverage}x)`
              : `Short ${asset.ticker}`}
          </h3>
        </div>
      </div>

      {/* Direction Tabs: Long vs Short */}
      <div className="grid grid-cols-2 gap-1 mb-4 bg-[#080808] p-1 border border-[#181917] rounded-sm font-display text-xs">
        <button
          onClick={() => setDirection("LONG")}
          className={`py-1.5 px-2 rounded text-center transition-all font-medium truncate ${
            direction === "LONG"
              ? "bg-[#c2ff47] text-[#080808] font-bold shadow-[0_0_8px_rgba(194,255,71,0.2)]"
              : "text-[#9b9b99] hover:text-white hover:bg-[#141513]"
          }`}
        >
          Spot Long (2x)
        </button>
        <button
          onClick={() => setDirection("SHORT")}
          className={`py-1.5 px-2 rounded text-center transition-all font-medium truncate flex items-center justify-center gap-1.5 ${
            direction === "SHORT"
              ? "bg-[#c2ff47] text-[#080808] font-bold shadow-[0_0_8px_rgba(194,255,71,0.2)]"
              : "text-[#9b9b99] hover:text-white hover:bg-[#141513]"
          }`}
        >
          <span>Short</span>
          <span
            className={`text-[9px] px-1 py-0.2 rounded border shrink-0 ${
              direction === "SHORT"
                ? "bg-[#111] text-[#c2ff47] border-[#292a27]"
                : "bg-[#2a1414] text-[#ff6b6b] border-[#3e1e1e]"
            }`}
          >
            Restricted
          </span>
        </button>
      </div>

      {/* Warning if SHORT is selected */}
      {direction === "SHORT" ? (
        <div className="flex flex-col gap-3.5 mb-4 font-sans">
          {/* Pro Risk Card */}
          <div className="bg-[#120c0c] border border-[#331c1c] p-3.5 sm:p-4 rounded-sm">
            <div className="flex flex-col gap-1.5 pb-2.5 border-b border-[#251414]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <svg className="w-3.5 h-3.5 text-[#ff6b6b] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="font-display font-bold text-xs text-[#f4f4f0] uppercase tracking-wide truncate">
                    Short Selling Unavailable
                  </span>
                </div>
                <span className="text-[9px] bg-[#221010] text-[#ff6b6b] border border-[#3e1e1e] px-1.5 py-0.5 rounded font-mono shrink-0">
                  SHORT_INVENTORY_UNAVAILABLE
                </span>
              </div>
            </div>

            <p className="mt-2.5 text-xs text-[#cfd0cc] leading-relaxed">
              In compliance with the implementation specification, synthetic short positions
              without confirmed underlying borrow inventory are disabled. True spot shorting
              requires a separate stock lending inventory pool on Robinhood Chain.
            </p>

            {/* Protocol Rule Details */}
            <div className="mt-3 pt-2.5 border-t border-[#251414] flex flex-col gap-1.5 text-[11px] font-mono">
              <div className="bg-[#0b0707] border border-[#201111] px-2.5 py-1.5 rounded flex items-center justify-between gap-2">
                <span className="text-[#888] truncate">Borrow Inventory</span>
                <span className="text-[#ff6b6b] font-semibold shrink-0">0 Confirmed Locates</span>
              </div>
              <div className="bg-[#0b0707] border border-[#201111] px-2.5 py-1.5 rounded flex items-center justify-between gap-2">
                <span className="text-[#888] truncate">Synthetic Shorts</span>
                <span className="text-[#ff6b6b] font-semibold shrink-0">Strictly Prohibited</span>
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex flex-col gap-2">
            <button
              disabled
              className="w-full py-3 px-3 rounded bg-[#1c1212] text-[#ff6b6b] border border-[#301c1c] font-display font-bold text-xs uppercase cursor-not-allowed truncate"
            >
              Short Execution Disabled
            </button>
            <button
              onClick={() => setDirection("LONG")}
              className="w-full py-2.5 px-3 rounded bg-[#161814] hover:bg-[#1d201a] text-[#c2ff47] border border-[#2e3325] font-display font-medium text-xs transition-colors truncate"
            >
              Switch to Spot Long (Buy &amp; Borrow)
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* User Margin Input Box */}
          <div className="bg-[#080808] border border-[#1f201d] p-3 sm:p-3.5 rounded-sm mb-4">
            <div className="flex items-center justify-between text-xs mb-2 gap-2">
              <span className="text-[#888] font-display text-[11px] truncate">Deposit Margin Equity</span>
              <span className="text-[#777] font-mono text-[10px] truncate text-right">Available: $1,250 USDG</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <input
                type="number"
                min="10"
                step="10"
                value={marginUsd}
                onChange={(e) => setMarginUsd(e.target.value)}
                placeholder="0.00"
                className="w-full min-w-0 bg-transparent font-mono text-xl sm:text-2xl text-[#f4f4f0] focus:outline-none placeholder-[#444]"
              />
              <span className="font-display font-bold text-xs px-2.5 py-1 bg-[#161715] text-[#c2ff47] border border-[#292a27] rounded shrink-0">
                USDG
              </span>
            </div>
          </div>

          {/* Leverage Slider */}
          <div className="bg-[#0e0f0e] border border-[#1f201d] p-3 sm:p-3.5 rounded-sm mb-4">
            <div className="flex items-center justify-between text-xs mb-2 gap-2">
              <span className="text-[#888] font-display text-[11px] truncate">Target Leverage Ratio</span>
              <span className="font-mono text-base font-bold text-[#c2ff47] shrink-0">
                {leverage.toFixed(1)}x
              </span>
            </div>
            <input
              type="range"
              min="1.1"
              max={maxLeverage}
              step="0.1"
              value={leverage}
              onChange={(e) => setLeverage(parseFloat(e.target.value))}
              className="w-full accent-[#c2ff47] cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-[#666] font-mono mt-1.5">
              <span>1.1x</span>
              <span>1.5x</span>
              <span>{maxLeverage.toFixed(1)}x Max</span>
            </div>
          </div>

          {/* Risk Metrics & Exposure Card */}
          <div className="bg-[#080808] border border-[#181917] p-3 sm:p-3.5 rounded-sm mb-4 font-mono text-xs divide-y divide-[#141513]">
            <div className="flex items-center justify-between pb-2 gap-2">
              <span className="text-[#777] font-sans truncate">Total Market Exposure</span>
              <div className="text-right shrink-0">
                <span className="text-[#f4f4f0] font-semibold">${totalExposureUsd.toFixed(2)}</span>{" "}
                <span className="text-[#777] text-[10px]">({tokensAcquired.toFixed(4)} {asset.ticker})</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-2 gap-2">
              <span className="text-[#777] font-sans truncate">USDG Borrowed</span>
              <span className="text-[#f4f4f0] shrink-0">${borrowedUsdg.toFixed(2)} USDG</span>
            </div>
            <div className="flex items-center justify-between py-2 gap-2">
              <span className="text-[#777] font-sans truncate">Health Factor</span>
              <span
                className={`font-bold shrink-0 ${
                  estimatedHf > 1.5 ? "text-[#c2ff47]" : estimatedHf > 1.2 ? "text-[#f5a623]" : "text-[#ff6b6b]"
                }`}
              >
                {estimatedHf.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between py-2 gap-2">
              <span className="text-[#777] font-sans truncate">Estimated Liq Price</span>
              <span className="text-[#f5a623] font-bold shrink-0">${estimatedLiqPrice.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between pt-2 text-[11px] gap-2">
              <span className="text-[#666] font-sans truncate">Daily Borrow Fee</span>
              <span className="text-[#888] shrink-0">
                ${dailyInterestUsd.toFixed(3)}/day ({borrowApr}%)
              </span>
            </div>
          </div>

          {/* Action Button */}
          {!isMarketOpen ? (
            <button
              disabled
              className="w-full py-3 px-3 rounded bg-[#181816] text-[#ff6b6b] border border-[#2a1a1a] font-display font-bold text-xs uppercase cursor-not-allowed flex items-center justify-center gap-2"
            >
              <span className="truncate">Market Closed (Session Inactive)</span>
              <span className="text-[10px] bg-[#2a1414] px-1.5 py-0.5 rounded font-mono shrink-0">
                CLOSED
              </span>
            </button>
          ) : (
            <button
              onClick={handleOpenModal}
              disabled={numMargin <= 0}
              className={`w-full py-3 px-4 rounded font-display font-bold text-xs uppercase transition-all tracking-wider ${
                numMargin > 0
                  ? "bg-[#c2ff47] hover:bg-[#daff92] text-[#080808] shadow-[0_0_14px_rgba(194,255,71,0.25)] cursor-pointer"
                  : "bg-[#1a1c17] text-[#666] border border-[#242721] cursor-not-allowed"
              }`}
            >
              <div className="flex items-center justify-center gap-1.5 truncate">
                <span>Open {leverage.toFixed(1)}x Long {asset.ticker}</span>
                <span className="font-mono text-[11px] opacity-85">
                  (${marginUsd || "0"} Margin)
                </span>
              </div>
            </button>
          )}

          {/* Confirmation Feedback Banner & Open Position Card */}
          {confirmedTxHash && (
            <div className="mt-4 p-3.5 bg-[rgba(194,255,71,0.06)] border border-[rgba(194,255,71,0.3)] rounded-sm text-xs font-mono text-[#c2ff47] flex flex-col gap-3">
              <div>
                <div className="font-bold font-display uppercase tracking-wide flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-[#c2ff47] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-sm">Long Position Successfully Opened</span>
                </div>
                <div className="text-[11px] text-[#9b9b99] mt-1 break-all font-mono">
                  Tx Hash: {confirmedTxHash}
                </div>
                <div className="text-[10px] text-[#888] mt-0.5">
                  Settled in atomic transaction · Block #149204 · Synced to Local Storage
                </div>
              </div>

              {/* ACTIVE OPEN POSITION DETAILS CARD */}
              {(executedPosition || activeStoredPosition) && (
                <div className="bg-[#080808] border border-[rgba(194,255,71,0.25)] p-3 rounded-sm text-xs text-[#f4f4f0] flex flex-col gap-2">
                  <div className="flex items-center justify-between border-b border-[#1c1d1a] pb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#c2ff47] animate-pulse shrink-0" />
                      <span className="font-display font-bold text-xs uppercase tracking-wider text-[#c2ff47]">
                        Active Open Position
                      </span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(194,255,71,0.12)] text-[#c2ff47] font-display font-semibold">
                      {(executedPosition || activeStoredPosition)?.leverage.toFixed(1)}x Long
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                    <div className="bg-[#0d0e0c] p-2 rounded border border-[#1b1c19]">
                      <span className="text-[#777] block text-[10px] uppercase font-sans">Market Exposure</span>
                      <span className="text-[#f4f4f0] font-bold text-xs">
                        ${(executedPosition || activeStoredPosition)?.collateralUsd.toFixed(2)}
                      </span>
                      <span className="text-[#777] text-[10px] block">
                        ({(executedPosition || activeStoredPosition)?.collateralTokens.toFixed(4)} {asset.ticker})
                      </span>
                    </div>
                    <div className="bg-[#0d0e0c] p-2 rounded border border-[#1b1c19]">
                      <span className="text-[#777] block text-[10px] uppercase font-sans">Margin Equity</span>
                      <span className="text-[#c2ff47] font-bold text-xs">
                        ${(executedPosition || activeStoredPosition)?.equityUsd.toFixed(2)} USDG
                      </span>
                      <span className="text-[#888] text-[10px] block">
                        Debt: ${(executedPosition || activeStoredPosition)?.debtUsd.toFixed(2)}
                      </span>
                    </div>
                    <div className="bg-[#0d0e0c] p-2 rounded border border-[#1b1c19]">
                      <span className="text-[#777] block text-[10px] uppercase font-sans">Health Factor</span>
                      <span className="text-[#c2ff47] font-bold">
                        {(executedPosition || activeStoredPosition)?.healthFactor.toFixed(2)}
                      </span>
                    </div>
                    <div className="bg-[#0d0e0c] p-2 rounded border border-[#1b1c19]">
                      <span className="text-[#777] block text-[10px] uppercase font-sans">Liq Reference</span>
                      <span className="text-[#f5a623] font-bold">
                        ${(executedPosition || activeStoredPosition)?.liquidationPrice.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <a
                    href="#positions-table"
                    className="mt-1 py-1.5 px-2.5 rounded bg-[#161814] hover:bg-[#1f221a] text-[#c2ff47] border border-[#2c3322] font-display font-semibold text-[11px] text-center transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span>View in Your Active Positions Table</span>
                    <span>↓</span>
                  </a>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* WALLET SIGNATURE CONFIRMATION MODAL */}
      <ChinaWalletSignatureModal
        isOpen={isSignatureModalOpen}
        onClose={() => setIsSignatureModalOpen(false)}
        onConfirmed={handleWalletConfirmed}
        txDetails={{
          title: `Open ${leverage.toFixed(1)}x Long ${asset.ticker}`,
          actionName: "executeAtomicLeverageLong",
          assetSymbol: asset.ticker,
          details: [
            { label: "Margin Deposit", value: `$${numMargin.toFixed(2)} USDG` },
            { label: "Borrowed Capital", value: `$${borrowedUsdg.toFixed(2)} USDG` },
            { label: "Total Exposure", value: `$${totalExposureUsd.toFixed(2)} USDG (${tokensAcquired.toFixed(4)} ${asset.ticker})` },
            { label: "Effective Leverage", value: `${leverage.toFixed(1)}x` },
            { label: "Estimated Health Factor", value: estimatedHf.toFixed(2) },
            { label: "Estimated Liq Price", value: `$${estimatedLiqPrice.toFixed(2)}` },
          ],
        }}
      />
    </div>
  );
}
