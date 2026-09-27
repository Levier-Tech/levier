"use client";

import React, { useState, useMemo } from "react";
import {
  type ChineseEquityAsset,
  type ChineseEquityMarket,
  type ChineseEquityPosition,
  formatCurrency,
  loadStoredChinesePositions,
} from "../../lib/chinese-equities-client";
import { ChinaWalletSignatureModal } from "./ChinaWalletSignatureModal";

export function ChinaSpotTradePanel({
  asset,
  market,
  onPositionOpened,
}: {
  asset: ChineseEquityAsset;
  market?: ChineseEquityMarket;
  onPositionOpened?: (position: ChineseEquityPosition) => void;
}) {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [amount, setAmount] = useState<string>("");
  const [slippage, setSlippage] = useState<number>(0.5);
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [executedPosition, setExecutedPosition] = useState<ChineseEquityPosition | null>(null);

  // User Balances (calibrated for small retail testing)
  const [usdgBalance, setUsdgBalance] = useState<number>(1250.0);
  const [tokenBalance, setTokenBalance] = useState<number>(3.5);

  const activeStoredPosition = useMemo(() => {
    if (typeof window === "undefined") return null;
    const stored = loadStoredChinesePositions();
    return stored.find((p) => p.assetSymbol.toUpperCase() === asset.ticker.toUpperCase()) || null;
  }, [asset.ticker, txHash]);

  const tokenPrice = market?.executableAskPrice ?? market?.tokenReferencePriceUsd ?? 85.0;
  const isMarketOpen = market?.marketSession === "REGULAR" || market?.marketSession === "PRE_MARKET";
  const isSpotEnabled = market?.capabilities.spot ?? false;

  // Calculate outputs
  const numAmount = parseFloat(amount) || 0;
  const executionFee = numAmount * 0.001; // 0.1% protocol fee
  const priceImpactBps = numAmount > 5000 ? 0.12 : 0.03;

  let estimatedReceived = 0;
  if (side === "BUY") {
    // Spending USDG, receiving Token
    const netUsd = Math.max(0, numAmount - executionFee);
    estimatedReceived = tokenPrice > 0 ? netUsd / tokenPrice : 0;
  } else {
    // Spending Token, receiving USDG
    const grossUsd = numAmount * tokenPrice;
    estimatedReceived = Math.max(0, grossUsd - (grossUsd * 0.001));
  }

  const handleQuickPercent = (pct: number) => {
    if (side === "BUY") {
      const val = (usdgBalance * pct) / 100;
      setAmount(val.toFixed(2));
    } else {
      const val = (tokenBalance * pct) / 100;
      setAmount(val.toFixed(4));
    }
  };

  const handleOpenModal = () => {
    if (!numAmount || numAmount <= 0) return;
    setIsSignatureModalOpen(true);
  };

  const handleWalletConfirmed = (confirmedHash: string) => {
    setTxHash(confirmedHash);
    setIsSignatureModalOpen(false);

    if (side === "BUY") {
      setUsdgBalance((prev) => Math.max(0, prev - numAmount));
      setTokenBalance((prev) => prev + estimatedReceived);

      const newPos: ChineseEquityPosition = {
        id: `pos-spot-${Date.now()}`,
        marketId: market?.marketId ?? null,
        assetSymbol: asset.ticker,
        name: `${asset.ticker} Spot`,
        positionType: "SPOT",
        leverage: 1.0,
        collateralTokens: Number(estimatedReceived.toFixed(4)),
        collateralUsd: Number(numAmount.toFixed(2)),
        debtUsd: 0,
        equityUsd: Number(numAmount.toFixed(2)),
        entryPrice: Number(tokenPrice.toFixed(2)),
        markPrice: Number(tokenPrice.toFixed(2)),
        liquidationPrice: 0,
        healthFactor: 99.99,
        currentLtv: 0,
        liquidationThreshold: 0,
        pnlUsd: 0,
        pnlPercent: 0,
        accruedInterestUsd: 0,
        openedAt: new Date().toISOString(),
        status: "HEALTHY",
        riskTier: market?.riskTier ?? "Tier A",
      };

      setExecutedPosition(newPos);
      if (onPositionOpened) {
        onPositionOpened(newPos);
      }
    } else {
      setTokenBalance((prev) => Math.max(0, prev - numAmount));
      setUsdgBalance((prev) => prev + estimatedReceived);

      const sellRecord: ChineseEquityPosition = {
        id: `pos-spot-sale-${Date.now()}`,
        marketId: market?.marketId ?? null,
        assetSymbol: asset.ticker,
        name: `${asset.ticker} Spot Sale`,
        positionType: "SPOT",
        leverage: 1.0,
        collateralTokens: Number(numAmount.toFixed(4)),
        collateralUsd: Number((numAmount * tokenPrice).toFixed(2)),
        debtUsd: 0,
        equityUsd: Number(estimatedReceived.toFixed(2)),
        entryPrice: Number(tokenPrice.toFixed(2)),
        markPrice: Number(tokenPrice.toFixed(2)),
        liquidationPrice: 0,
        healthFactor: 99.99,
        currentLtv: 0,
        liquidationThreshold: 0,
        pnlUsd: 0,
        pnlPercent: 0,
        accruedInterestUsd: 0,
        openedAt: new Date().toISOString(),
        closedAt: new Date().toISOString(),
        status: "CLOSED",
        riskTier: market?.riskTier ?? "Tier A",
      };

      setExecutedPosition(sellRecord);
      if (onPositionOpened) {
        onPositionOpened(sellRecord);
      }
    }
  };

  return (
    <div className="w-full bg-[#0c0d0c] border border-[#1f201d] p-4 sm:p-5 rounded-sm font-sans box-border overflow-hidden">
      {/* Header & Wallet Balance */}
      <div className="flex flex-col gap-2 pb-3.5 mb-4 border-b border-[#181917]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-[#777] uppercase font-display tracking-wider truncate">
            Spot Execution · Robinhood Chain
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#161715] border border-[#262823] text-[#c2ff47] font-mono shrink-0">
            RFQ VENUE
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-bold font-display text-[#f4f4f0] truncate">
            {side === "BUY" ? `Buy ${asset.ticker}` : `Sell ${asset.ticker}`}
          </h3>
          <div className="text-right text-xs shrink-0 font-mono">
            <span className="text-[#777] text-[10px] block font-sans">Wallet Balance</span>
            <span className="text-[#f4f4f0] font-semibold text-xs">
              {side === "BUY" ? `$${usdgBalance.toLocaleString()} USDG` : `${tokenBalance.toFixed(4)} ${asset.ticker}`}
            </span>
          </div>
        </div>
      </div>

      {/* Side Toggle: BUY vs SELL */}
      <div className="grid grid-cols-2 gap-1 mb-4 bg-[#080808] p-1 border border-[#181917] rounded-sm font-display text-xs">
        <button
          onClick={() => {
            setSide("BUY");
            setAmount("");
          }}
          className={`py-1.5 px-2 rounded text-center transition-all font-medium truncate ${
            side === "BUY"
              ? "bg-[#c2ff47] text-[#080808] font-bold shadow-[0_0_8px_rgba(194,255,71,0.2)]"
              : "text-[#9b9b99] hover:text-white hover:bg-[#141513]"
          }`}
        >
          Buy {asset.ticker}
        </button>
        <button
          onClick={() => {
            setSide("SELL");
            setAmount("");
          }}
          className={`py-1.5 px-2 rounded text-center transition-all font-medium truncate ${
            side === "SELL"
              ? "bg-[#c2ff47] text-[#080808] font-bold shadow-[0_0_8px_rgba(194,255,71,0.2)]"
              : "text-[#9b9b99] hover:text-white hover:bg-[#141513]"
          }`}
        >
          Sell {asset.ticker}
        </button>
      </div>

      {/* Amount Input */}
      <div className="bg-[#080808] border border-[#1f201d] p-3 sm:p-3.5 rounded-sm mb-4">
        <div className="flex items-center justify-between text-xs mb-2 gap-2">
          <span className="text-[#888] font-display text-[11px] truncate">
            {side === "BUY" ? "You Spend (USDG)" : `You Sell (${asset.ticker})`}
          </span>
          <div className="flex items-center gap-1 text-[10px] font-mono shrink-0">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                onClick={() => handleQuickPercent(pct)}
                className="px-1.5 py-0.5 rounded bg-[#161715] hover:bg-[#252822] text-[#9b9b99] hover:text-[#c2ff47] border border-[#292a27] transition-colors"
              >
                {pct === 100 ? "MAX" : `${pct}%`}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <input
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full min-w-0 bg-transparent font-mono text-xl sm:text-2xl text-[#f4f4f0] focus:outline-none placeholder-[#444]"
          />
          <span className="font-display font-bold text-xs px-2.5 py-1 bg-[#161715] text-[#c2ff47] border border-[#292a27] rounded shrink-0">
            {side === "BUY" ? "USDG" : asset.ticker}
          </span>
        </div>
      </div>

      {/* Output Summary Card */}
      <div className="bg-[#080808] border border-[#181917] p-3 sm:p-3.5 rounded-sm mb-4 font-mono text-xs divide-y divide-[#141513]">
        <div className="flex items-center justify-between pb-2 gap-2">
          <span className="text-[#777] font-sans truncate">Estimated Receipt</span>
          <span className="text-[#c2ff47] font-bold text-sm shrink-0">
            {side === "BUY"
              ? `${estimatedReceived.toFixed(4)} ${asset.ticker}`
              : `$${estimatedReceived.toFixed(2)} USDG`}
          </span>
        </div>

        <div className="flex items-center justify-between py-2 gap-2">
          <span className="text-[#777] font-sans truncate">Execution Route</span>
          <span className="text-[#f4f4f0] text-[11px] shrink-0">Robinhood Chain RFQ</span>
        </div>

        <div className="flex items-center justify-between py-2 gap-2">
          <span className="text-[#777] font-sans truncate">Reference Price</span>
          <span className="text-[#bbb] text-[11px] shrink-0">${tokenPrice.toFixed(2)} USD</span>
        </div>

        <div className="flex items-center justify-between py-2 gap-2">
          <span className="text-[#777] font-sans truncate">Slippage Tolerance</span>
          <div className="flex items-center gap-1 shrink-0">
            {[0.1, 0.5, 1.0].map((val) => (
              <button
                key={val}
                onClick={() => setSlippage(val)}
                className={`px-1.5 py-0.5 rounded text-[10px] ${
                  slippage === val
                    ? "bg-[#c2ff47] text-[#080808] font-bold"
                    : "bg-[#181917] text-[#888] hover:text-white"
                }`}
              >
                {val}%
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 text-[11px] gap-2">
          <span className="text-[#666] font-sans truncate">Protocol Fee (0.10%)</span>
          <span className="text-[#888] shrink-0">${executionFee.toFixed(3)} USDG</span>
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
          disabled={!numAmount || numAmount <= 0}
          className={`w-full py-3 px-4 rounded font-display font-bold text-xs uppercase transition-all tracking-wider ${
            numAmount > 0
              ? side === "BUY"
                ? "bg-[#c2ff47] hover:bg-[#daff92] text-[#080808] shadow-[0_0_14px_rgba(194,255,71,0.25)] cursor-pointer"
                : "bg-[#ff6b6b] hover:bg-[#ff8585] text-[#080808] shadow-[0_0_14px_rgba(255,107,107,0.25)] cursor-pointer"
              : "bg-[#1a1c17] text-[#666] border border-[#242721] cursor-not-allowed"
          }`}
        >
          <div className="flex items-center justify-center gap-1.5 truncate">
            <span>{side === "BUY" ? "Buy" : "Sell"}</span>
            <span className="font-mono">{amount || "0"}</span>
            <span>{side === "BUY" ? `USDG of ${asset.ticker}` : asset.ticker}</span>
          </div>
        </button>
      )}

      {/* Confirmation Feedback Banner & Open Position Card */}
      {txHash && (
        <div className="mt-4 p-3.5 bg-[rgba(194,255,71,0.06)] border border-[rgba(194,255,71,0.3)] rounded-sm text-xs font-mono text-[#c2ff47] flex flex-col gap-3">
          <div>
            <div className="font-bold font-display uppercase tracking-wide flex items-center gap-1.5">
              <svg className="w-4 h-4 text-[#c2ff47] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-sm">Order Executed Successfully</span>
            </div>
            <div className="text-[11px] text-[#9b9b99] mt-1 break-all font-mono">
              Tx Hash: {txHash}
            </div>
            <div className="text-[10px] text-[#888] mt-0.5">
              Confirmed on Robinhood Chain · Block #149204 · Synced to Local Storage
            </div>
          </div>

          {/* ACTIVE POSITION DETAILS CARD */}
          {(executedPosition || activeStoredPosition) && (() => {
            const cur = executedPosition || activeStoredPosition;
            const isClosed = cur?.status === "CLOSED";
            return (
              <div className="bg-[#080808] border border-[rgba(194,255,71,0.25)] p-3 rounded-sm text-xs text-[#f4f4f0] flex flex-col gap-2">
                <div className="flex items-center justify-between border-b border-[#1c1d1a] pb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${isClosed ? "bg-[#888]" : "bg-[#c2ff47] animate-pulse"} shrink-0`} />
                    <span className="font-display font-bold text-xs uppercase tracking-wider text-[#c2ff47]">
                      {isClosed ? "Trade History Record" : "Active Open Position"}
                    </span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(194,255,71,0.12)] text-[#c2ff47] font-display font-semibold">
                    {isClosed ? "Spot Sale (Settled)" : cur?.positionType === "SPOT" ? "Spot Hold (1x)" : "Long Position"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div className="bg-[#0d0e0c] p-2 rounded border border-[#1b1c19]">
                    <span className="text-[#777] block text-[10px] uppercase font-sans">
                      {isClosed ? "Tokens Sold" : "Token Holdings"}
                    </span>
                    <span className="text-[#f4f4f0] font-bold text-xs">
                      {cur?.collateralTokens.toFixed(4)} {asset.ticker}
                    </span>
                  </div>
                  <div className="bg-[#0d0e0c] p-2 rounded border border-[#1b1c19]">
                    <span className="text-[#777] block text-[10px] uppercase font-sans">
                      {isClosed ? "Proceeds Received" : "Position Value"}
                    </span>
                    <span className="text-[#c2ff47] font-bold text-xs">
                      ${cur?.equityUsd.toFixed(2)} USDG
                    </span>
                  </div>
                  <div className="bg-[#0d0e0c] p-2 rounded border border-[#1b1c19]">
                    <span className="text-[#777] block text-[10px] uppercase font-sans">
                      {isClosed ? "Execution Price" : "Entry Price"}
                    </span>
                    <span className="text-[#f4f4f0] font-bold">
                      ${cur?.entryPrice.toFixed(2)}
                    </span>
                  </div>
                  <div className="bg-[#0d0e0c] p-2 rounded border border-[#1b1c19]">
                    <span className="text-[#777] block text-[10px] uppercase font-sans">Status</span>
                    <span className="text-[#c2ff47] font-bold">
                      {isClosed ? "Settled to Wallet" : "Healthy (Safe)"}
                    </span>
                  </div>
                </div>

                <a
                  href="#positions-table"
                  className="mt-1 py-1.5 px-2.5 rounded bg-[#161814] hover:bg-[#1f221a] text-[#c2ff47] border border-[#2c3322] font-display font-semibold text-[11px] text-center transition-colors flex items-center justify-center gap-1.5"
                >
                  <span>View in Positions History Table</span>
                  <span>↓</span>
                </a>
              </div>
            );
          })()}
        </div>
      )}

      {/* WALLET SIGNATURE CONFIRMATION MODAL */}
      <ChinaWalletSignatureModal
        isOpen={isSignatureModalOpen}
        onClose={() => setIsSignatureModalOpen(false)}
        onConfirmed={handleWalletConfirmed}
        txDetails={{
          title: side === "BUY" ? `Buy ${asset.ticker}` : `Sell ${asset.ticker}`,
          actionName: side === "BUY" ? "swapUsdgForTokens" : "swapTokensForUsdg",
          assetSymbol: asset.ticker,
          details: [
            {
              label: "Order Action",
              value: side === "BUY" ? `Acquire ${asset.ticker}` : `Sell ${asset.ticker} for USDG`,
            },
            {
              label: "Amount",
              value: side === "BUY" ? `$${numAmount.toFixed(2)} USDG` : `${numAmount.toFixed(4)} ${asset.ticker}`,
            },
            {
              label: "Estimated Output",
              value: side === "BUY" ? `${estimatedReceived.toFixed(4)} ${asset.ticker}` : `$${estimatedReceived.toFixed(2)} USDG`,
            },
            {
              label: "Max Slippage",
              value: `${slippage}%`,
            },
          ],
        }}
      />
    </div>
  );
}
