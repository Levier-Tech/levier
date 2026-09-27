"use client";

import React, { useState, useMemo } from "react";
import {
  type ChineseEquityAsset,
  type ChineseEquityMarket,
  type ChineseEquityPosition,
  calculateHealthFactor,
  calculateLiquidationPrice,
  calculateLtv,
  calculateMaxBorrowCapacity,
  formatCurrency,
  loadStoredChinesePositions,
} from "../../lib/chinese-equities-client";
import { ChinaWalletSignatureModal } from "./ChinaWalletSignatureModal";

type LendingMode = "DEPOSIT" | "BORROW" | "REPAY" | "WITHDRAW";

export function ChinaLendingPanel({
  asset,
  market,
  onPositionOpened,
}: {
  asset: ChineseEquityAsset;
  market?: ChineseEquityMarket;
  onPositionOpened?: (newPos: ChineseEquityPosition) => void;
}) {
  const [mode, setMode] = useState<LendingMode>("DEPOSIT");
  const [amount, setAmount] = useState<string>("");
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [executedPosition, setExecutedPosition] = useState<ChineseEquityPosition | null>(null);

  // User Position State (calibrated for small retail testing)
  const [depositedCollateralTokens, setDepositedCollateralTokens] = useState<number>(2.0);
  const [borrowedDebtUsdg, setBorrowedDebtUsdg] = useState<number>(65.0);
  const [walletTokenBalance, setWalletTokenBalance] = useState<number>(3.5);
  const [walletUsdgBalance, setWalletUsdgBalance] = useState<number>(1250.0);

  const activeStoredPosition = useMemo(() => {
    if (typeof window === "undefined") return null;
    const stored = loadStoredChinesePositions();
    return (
      stored.find(
        (p) =>
          p.assetSymbol.toUpperCase() === asset.ticker.toUpperCase() &&
          p.positionType === "COLLATERAL_BORROW"
      ) || null
    );
  }, [asset.ticker, txHash]);

  const tokenPrice = market?.tokenReferencePriceUsd ?? 85.0;
  const openingLtv = market?.openingLtv ?? 35.0;
  const liquidationThreshold = market?.liquidationThreshold ?? 45.0;
  const isMarketOpen = market?.marketSession === "REGULAR" || market?.marketSession === "PRE_MARKET";
  const isBorrowEnabled = market?.capabilities.borrow ?? false;

  // Numerical inputs & derived calculations
  const numInput = parseFloat(amount) || 0;

  // Compute what current & projected positions look like
  let projectedCollateralTokens = depositedCollateralTokens;
  let projectedDebtUsdg = borrowedDebtUsdg;

  if (mode === "DEPOSIT") {
    projectedCollateralTokens += numInput;
  } else if (mode === "WITHDRAW") {
    projectedCollateralTokens = Math.max(0, projectedCollateralTokens - numInput);
  } else if (mode === "BORROW") {
    projectedDebtUsdg += numInput;
  } else if (mode === "REPAY") {
    projectedDebtUsdg = Math.max(0, projectedDebtUsdg - numInput);
  }

  const currentCollateralValueUsd = depositedCollateralTokens * tokenPrice;
  const projectedCollateralValueUsd = projectedCollateralTokens * tokenPrice;

  const currentLtv = calculateLtv(borrowedDebtUsdg, currentCollateralValueUsd);
  const projectedLtv = calculateLtv(projectedDebtUsdg, projectedCollateralValueUsd);

  const currentHf = calculateHealthFactor(
    currentCollateralValueUsd,
    liquidationThreshold,
    borrowedDebtUsdg
  );
  const projectedHf = calculateHealthFactor(
    projectedCollateralValueUsd,
    liquidationThreshold,
    projectedDebtUsdg
  );

  const currentLiqPrice = calculateLiquidationPrice(
    borrowedDebtUsdg,
    depositedCollateralTokens,
    liquidationThreshold
  );
  const projectedLiqPrice = calculateLiquidationPrice(
    projectedDebtUsdg,
    projectedCollateralTokens,
    liquidationThreshold
  );

  const maxBorrowAllowed = Math.max(
    0,
    calculateMaxBorrowCapacity(currentCollateralValueUsd, openingLtv) - borrowedDebtUsdg
  );

  // Validation
  const isBorrowExceedingLtv = mode === "BORROW" && projectedLtv > openingLtv;
  const isWithdrawBreachingLtv = mode === "WITHDRAW" && projectedLtv > liquidationThreshold;

  const handleOpenModal = () => {
    if (!numInput || numInput <= 0) return;
    setIsSignatureModalOpen(true);
  };

  const handleWalletConfirmed = (confirmedHash: string) => {
    setTxHash(confirmedHash);
    setIsSignatureModalOpen(false);

    // Apply state update
    if (mode === "DEPOSIT") {
      setDepositedCollateralTokens((prev) => prev + numInput);
      setWalletTokenBalance((prev) => Math.max(0, prev - numInput));
    } else if (mode === "BORROW") {
      setBorrowedDebtUsdg((prev) => prev + numInput);
      setWalletUsdgBalance((prev) => prev + numInput);
    } else if (mode === "REPAY") {
      setBorrowedDebtUsdg((prev) => Math.max(0, prev - numInput));
      setWalletUsdgBalance((prev) => Math.max(0, prev - numInput));
    } else if (mode === "WITHDRAW") {
      setDepositedCollateralTokens((prev) => Math.max(0, prev - numInput));
      setWalletTokenBalance((prev) => prev + numInput);
    }

    if (onPositionOpened && (mode === "BORROW" || mode === "DEPOSIT")) {
      const pos: ChineseEquityPosition = {
        id: `pos-${asset.ticker.toLowerCase()}-borrow-${Date.now().toString().slice(-4)}`,
        marketId: market?.marketId ?? null,
        assetSymbol: asset.ticker,
        name: `${asset.ticker} / USDG`,
        positionType: "COLLATERAL_BORROW",
        leverage: 1.0,
        collateralTokens: Number(projectedCollateralTokens.toFixed(4)),
        collateralUsd: Number(projectedCollateralValueUsd.toFixed(2)),
        debtUsd: Number(projectedDebtUsdg.toFixed(2)),
        equityUsd: Number((projectedCollateralValueUsd - projectedDebtUsdg).toFixed(2)),
        entryPrice: Number(tokenPrice.toFixed(2)),
        markPrice: Number(tokenPrice.toFixed(2)),
        liquidationPrice: Number(projectedLiqPrice.toFixed(2)),
        healthFactor: Number(projectedHf.toFixed(2)),
        currentLtv: Number(projectedLtv.toFixed(2)),
        liquidationThreshold,
        pnlUsd: 0,
        pnlPercent: 0,
        accruedInterestUsd: 0,
        openedAt: new Date().toISOString(),
        status: projectedHf < 1.0 ? "CRITICAL" : projectedHf < 1.3 ? "WARNING" : "HEALTHY",
        riskTier: market?.riskTier ?? "Tier A",
      };
      setExecutedPosition(pos);
      onPositionOpened(pos);
    }
  };

  return (
    <div className="w-full bg-[#0c0d0c] border border-[#1f201d] p-4 sm:p-5 rounded-sm font-sans box-border overflow-hidden">
      {/* Header & Market Parameters */}
      <div className="flex flex-col gap-2 pb-3.5 mb-4 border-b border-[#181917]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-[#777] uppercase font-display tracking-wider truncate">
            Isolated Lending · Boundary
          </span>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#888] shrink-0">
            <span>APR: <strong className="text-[#c2ff47]">{market?.borrowApr ?? 7.8}%</strong></span>
            <span className="text-[#444]">·</span>
            <span>Max LTV: <strong className="text-[#f4f4f0]">{openingLtv}%</strong></span>
          </div>
        </div>
        <h3 className="text-base font-bold font-display text-[#f4f4f0] truncate">
          {asset.ticker} Collateral / USDG Credit
        </h3>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="grid grid-cols-4 gap-1 mb-4 bg-[#080808] p-1 border border-[#181917] rounded-sm font-display text-[11px]">
        {(["DEPOSIT", "BORROW", "REPAY", "WITHDRAW"] as LendingMode[]).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setAmount("");
            }}
            className={`py-1.5 px-1 rounded text-center transition-all font-medium truncate ${
              mode === m
                ? "bg-[#c2ff47] text-[#080808] font-bold shadow-[0_0_8px_rgba(194,255,71,0.2)]"
                : "text-[#9b9b99] hover:text-white hover:bg-[#141513]"
            }`}
          >
            {m === "DEPOSIT"
              ? "Deposit"
              : m === "BORROW"
              ? "Borrow"
              : m === "REPAY"
              ? "Repay"
              : "Withdraw"}
          </button>
        ))}
      </div>

      {/* Input Box */}
      <div className="bg-[#080808] border border-[#1f201d] p-3 sm:p-3.5 rounded-sm mb-4">
        <div className="flex items-center justify-between text-xs mb-2 gap-2">
          <span className="text-[#888] font-display text-[11px] truncate">
            {mode === "DEPOSIT"
              ? `Deposit ${asset.ticker}`
              : mode === "BORROW"
              ? "Borrow USDG"
              : mode === "REPAY"
              ? "Repay USDG"
              : `Withdraw ${asset.ticker}`}
          </span>
          <span className="text-[#777] font-mono text-[10px] truncate text-right">
            {mode === "DEPOSIT"
              ? `Wallet: ${walletTokenBalance.toFixed(2)} ${asset.ticker}`
              : mode === "BORROW"
              ? `Max: $${maxBorrowAllowed.toFixed(2)}`
              : mode === "REPAY"
              ? `Debt: $${borrowedDebtUsdg.toFixed(2)}`
              : `Deposited: ${depositedCollateralTokens.toFixed(2)} ${asset.ticker}`}
          </span>
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
            {mode === "DEPOSIT" || mode === "WITHDRAW" ? asset.ticker : "USDG"}
          </span>
        </div>
      </div>

      {/* LTV & Risk Gauge */}
      <div className="bg-[#0e0f0e] border border-[#1f201d] p-3 sm:p-3.5 rounded-sm mb-4 font-sans">
        <div className="flex items-center justify-between text-xs mb-1.5 gap-2">
          <span className="text-[#888] font-display text-[11px] truncate">Projected LTV Ratio</span>
          <div className="flex items-center gap-1.5 font-mono text-xs shrink-0">
            <span className="text-[#666]">{currentLtv.toFixed(1)}%</span>
            <span className="text-[#777]">→</span>
            <span
              className={`font-bold ${
                projectedLtv > openingLtv
                  ? "text-[#ff6b6b]"
                  : projectedLtv > openingLtv * 0.8
                  ? "text-[#f5a623]"
                  : "text-[#c2ff47]"
              }`}
            >
              {projectedLtv.toFixed(1)}%
            </span>
            <span className="text-[#666] text-[10px]">(Max: {openingLtv}%)</span>
          </div>
        </div>

        {/* Multi-tier Progress Bar */}
        <div className="w-full h-2 bg-[#181917] rounded-full overflow-hidden flex relative">
          <div
            className={`h-full transition-all duration-300 ${
              projectedLtv > openingLtv
                ? "bg-[#ff6b6b]"
                : projectedLtv > openingLtv * 0.8
                ? "bg-[#f5a623]"
                : "bg-[#c2ff47]"
            }`}
            style={{ width: `${Math.min(100, projectedLtv)}%` }}
          />
        </div>

        <div className="flex justify-between text-[10px] text-[#666] font-mono mt-1.5">
          <span>0%</span>
          <span>Cap: {openingLtv}%</span>
          <span>Liq: {liquidationThreshold}%</span>
        </div>
      </div>

      {/* Derived Health Factor & Liquidation Breakdown */}
      <div className="bg-[#080808] border border-[#181917] p-3 sm:p-3.5 rounded-sm mb-4 font-mono text-xs divide-y divide-[#141513]">
        <div className="flex items-center justify-between pb-2 gap-2">
          <span className="text-[#777] font-sans truncate">Projected Health Factor</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[#666]">{currentHf.toFixed(2)}</span>
            <span className="text-[#777]">→</span>
            <span
              className={`font-bold ${
                projectedHf < 1.0
                  ? "text-[#ff6b6b]"
                  : projectedHf < 1.3
                  ? "text-[#f5a623]"
                  : "text-[#c2ff47]"
              }`}
            >
              {projectedHf >= 99 ? "Safe" : projectedHf.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between py-2 gap-2">
          <span className="text-[#777] font-sans truncate">Estimated Liq Price</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[#666]">${currentLiqPrice.toFixed(2)}</span>
            <span className="text-[#777]">→</span>
            <span className="text-[#f5a623] font-bold">
              ${projectedLiqPrice.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between py-2 gap-2">
          <span className="text-[#777] font-sans truncate">Total Collateral Value</span>
          <div className="text-right shrink-0">
            <span className="text-[#f4f4f0] font-semibold">${projectedCollateralValueUsd.toFixed(2)}</span>{" "}
            <span className="text-[#777] text-[10px]">({projectedCollateralTokens.toFixed(2)} {asset.ticker})</span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 gap-2">
          <span className="text-[#777] font-sans truncate">Total USDG Debt</span>
          <span className="text-[#f4f4f0] font-bold shrink-0">${projectedDebtUsdg.toFixed(2)} USDG</span>
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
      ) : isBorrowExceedingLtv ? (
        <button
          disabled
          className="w-full py-3 px-3 rounded bg-[#2a1414] text-[#ff6b6b] border border-[#3e1e1e] font-display font-bold text-xs uppercase cursor-not-allowed truncate"
        >
          Exceeds Opening LTV Limit ({openingLtv}%)
        </button>
      ) : isWithdrawBreachingLtv ? (
        <button
          disabled
          className="w-full py-3 px-3 rounded bg-[#2a1414] text-[#ff6b6b] border border-[#3e1e1e] font-display font-bold text-xs uppercase cursor-not-allowed truncate"
        >
          Withdrawal Breaches Liquidation Threshold
        </button>
      ) : (
        <button
          onClick={handleOpenModal}
          disabled={!numInput || numInput <= 0}
          className={`w-full py-3 px-4 rounded font-display font-bold text-xs uppercase transition-all tracking-wider ${
            numInput > 0
              ? "bg-[#c2ff47] hover:bg-[#daff92] text-[#080808] shadow-[0_0_14px_rgba(194,255,71,0.25)] cursor-pointer"
              : "bg-[#1a1c17] text-[#666] border border-[#242721] cursor-not-allowed"
          }`}
        >
          <div className="flex items-center justify-center gap-1.5 truncate">
            <span>
              {mode === "DEPOSIT"
                ? "Deposit"
                : mode === "BORROW"
                ? "Borrow"
                : mode === "REPAY"
                ? "Repay"
                : "Withdraw"}
            </span>
            <span className="font-mono">{amount || "0"}</span>
            <span>{mode === "DEPOSIT" || mode === "WITHDRAW" ? asset.ticker : "USDG"}</span>
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
              <span className="text-sm">Lending Transaction Confirmed</span>
            </div>
            <div className="text-[11px] text-[#9b9b99] mt-1 break-all font-mono">
              Tx Hash: {txHash}
            </div>
            <div className="text-[10px] text-[#888] mt-0.5">
              Collateral shares updated · Robinhood Chain Block #149204 · Synced to Local Storage
            </div>
          </div>

          {/* ACTIVE OPEN POSITION DETAILS CARD */}
          {(executedPosition || activeStoredPosition) && (
            <div className="bg-[#080808] border border-[rgba(194,255,71,0.25)] p-3 rounded-sm text-xs text-[#f4f4f0] flex flex-col gap-2">
              <div className="flex items-center justify-between border-b border-[#1c1d1a] pb-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#c2ff47] animate-pulse shrink-0" />
                  <span className="font-display font-bold text-xs uppercase tracking-wider text-[#c2ff47]">
                    Active Collateral &amp; Debt Position
                  </span>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(194,255,71,0.12)] text-[#c2ff47] font-display font-semibold">
                  Isolated Credit
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                <div className="bg-[#0d0e0c] p-2 rounded border border-[#1b1c19]">
                  <span className="text-[#777] block text-[10px] uppercase font-sans">Collateral Deposited</span>
                  <span className="text-[#f4f4f0] font-bold text-xs">
                    {(executedPosition || activeStoredPosition)?.collateralTokens.toFixed(4)} {asset.ticker}
                  </span>
                  <span className="text-[#777] text-[10px] block">
                    (${(executedPosition || activeStoredPosition)?.collateralUsd.toFixed(2)})
                  </span>
                </div>
                <div className="bg-[#0d0e0c] p-2 rounded border border-[#1b1c19]">
                  <span className="text-[#777] block text-[10px] uppercase font-sans">Borrowed Debt</span>
                  <span className="text-[#c2ff47] font-bold text-xs">
                    ${(executedPosition || activeStoredPosition)?.debtUsd.toFixed(2)} USDG
                  </span>
                  <span className="text-[#888] text-[10px] block">
                    Equity: ${(executedPosition || activeStoredPosition)?.equityUsd.toFixed(2)}
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

      {/* WALLET SIGNATURE CONFIRMATION MODAL */}
      <ChinaWalletSignatureModal
        isOpen={isSignatureModalOpen}
        onClose={() => setIsSignatureModalOpen(false)}
        onConfirmed={handleWalletConfirmed}
        txDetails={{
          title: `${mode} ${asset.ticker} / USDG`,
          actionName:
            mode === "DEPOSIT"
              ? "depositCollateral"
              : mode === "BORROW"
              ? "borrowIsolatedCredit"
              : mode === "REPAY"
              ? "repayCredit"
              : "withdrawCollateral",
          assetSymbol: asset.ticker,
          details: [
            {
              label: "Operation",
              value: mode === "DEPOSIT" ? "Deposit Collateral" : mode === "BORROW" ? "Borrow USDG" : mode,
            },
            {
              label: "Amount",
              value: mode === "DEPOSIT" || mode === "WITHDRAW" ? `${numInput} ${asset.ticker}` : `${numInput} USDG`,
            },
            {
              label: "Projected LTV",
              value: `${projectedLtv.toFixed(1)}%`,
            },
            {
              label: "Projected Health Factor",
              value: projectedHf >= 99 ? "Safe" : projectedHf.toFixed(2),
            },
          ],
        }}
      />
    </div>
  );
}
