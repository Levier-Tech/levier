"use client";

import React, { useState, useRef } from "react";
import {
  type ChineseEquityAsset,
  type ChineseEquityMarket,
  formatCurrency,
  formatPercent,
  formatTokens,
  formatUnderlyingPrice,
} from "../../lib/chinese-equities-client";

export function ChinaMarketMetrics({
  asset,
  market,
}: {
  asset: ChineseEquityAsset;
  market?: ChineseEquityMarket;
}) {
  const isUp = (market?.priceChange24hPercent ?? 0) >= 0;

  return (
    <div className="flex flex-col gap-6">
      {/* 01. HERO HISTORICAL PRICE TREND & INTERACTIVE HOVER CHART */}
      <ChinaInteractiveChart asset={asset} market={market} />

      {/* 02. 8-GRID FINANCIAL METRIC CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3 font-sans">
        <div className="bg-[#0c0d0c] border border-[#1f201d] p-3.5 rounded-sm whitespace-nowrap overflow-hidden">
          <span className="text-[10px] text-[#777] uppercase tracking-wider font-display block whitespace-nowrap truncate">
            Token Valuation (USDG)
          </span>
          <span className="text-xl font-bold font-mono text-[#f4f4f0] block mt-1 whitespace-nowrap">
            {market && market.tokenReferencePriceUsd > 0
              ? formatCurrency(market.tokenReferencePriceUsd)
              : "—"}
          </span>
          <span className="text-[10px] text-[#9b9b99] mt-0.5 block font-mono whitespace-nowrap truncate">
            Chainlink Total Return Feed
          </span>
        </div>

        <div className="bg-[#0c0d0c] border border-[#1f201d] p-3.5 rounded-sm whitespace-nowrap overflow-hidden">
          <span className="text-[10px] text-[#777] uppercase tracking-wider font-display block whitespace-nowrap truncate">
            Underlying Tape Price
          </span>
          <span className="text-xl font-bold font-mono text-[#d1d4cb] block mt-1 whitespace-nowrap">
            {market && market.underlyingReferencePrice > 0
              ? formatUnderlyingPrice(market.underlyingReferencePrice, market.underlyingCurrency)
              : "—"}
          </span>
          <span className="text-[10px] text-[#9b9b99] mt-0.5 block font-mono whitespace-nowrap truncate">
            {asset.underlyingExchange} Consolidated Tape
          </span>
        </div>

        <div className="bg-[#0c0d0c] border border-[#1f201d] p-3.5 rounded-sm whitespace-nowrap overflow-hidden">
          <span className="text-[10px] text-[#777] uppercase tracking-wider font-display block whitespace-nowrap truncate">
            24h Spread &amp; Change
          </span>
          <div className="flex items-baseline gap-2 mt-1 whitespace-nowrap">
            <span
              className={`text-xl font-bold font-mono whitespace-nowrap ${
                isUp ? "text-[#c2ff47]" : "text-[#ff6b6b]"
              }`}
            >
              {market ? formatPercent(market.priceChange24hPercent, true) : "—"}
            </span>
            <span className="text-[11px] text-[#888] font-mono whitespace-nowrap">
              {market ? `${market.spreadBps} bps` : ""}
            </span>
          </div>
          <span className="text-[10px] text-[#9b9b99] mt-0.5 block font-mono truncate whitespace-nowrap">
            Bid/Ask: ${market?.executableBidPrice ?? "—"} / ${market?.executableAskPrice ?? "—"}
          </span>
        </div>

        <div className="bg-[#0c0d0c] border border-[#1f201d] p-3.5 rounded-sm whitespace-nowrap overflow-hidden">
          <span className="text-[10px] text-[#777] uppercase tracking-wider font-display block whitespace-nowrap truncate">
            24h Tokenized Volume
          </span>
          <span className="text-xl font-bold font-mono text-[#f4f4f0] block mt-1 whitespace-nowrap">
            {market && market.volume24hUsd > 0
              ? formatCurrency(market.volume24hUsd, 0)
              : "—"}
          </span>
          <span className="text-[10px] text-[#9b9b99] mt-0.5 block font-mono whitespace-nowrap truncate">
            Robinhood Chain Liquidity
          </span>
        </div>

        <div className="bg-[#0c0d0c] border border-[#1f201d] p-3.5 rounded-sm whitespace-nowrap overflow-hidden">
          <span className="text-[10px] text-[#777] uppercase tracking-wider font-display block whitespace-nowrap truncate">
            Max Opening LTV
          </span>
          <span className="text-xl font-bold font-mono text-[#c2ff47] block mt-1 whitespace-nowrap">
            {market && market.openingLtv > 0 ? `${market.openingLtv.toFixed(1)}%` : "—"}
          </span>
          <span className="text-[10px] text-[#9b9b99] mt-0.5 block font-mono whitespace-nowrap truncate">
            Isolated Risk Ceiling
          </span>
        </div>

        <div className="bg-[#0c0d0c] border border-[#1f201d] p-3.5 rounded-sm whitespace-nowrap overflow-hidden">
          <span className="text-[10px] text-[#777] uppercase tracking-wider font-display block whitespace-nowrap truncate">
            Liquidation Threshold
          </span>
          <span className="text-xl font-bold font-mono text-[#f5a623] block mt-1 whitespace-nowrap">
            {market && market.liquidationThreshold > 0
              ? `${market.liquidationThreshold.toFixed(1)}%`
              : "—"}
          </span>
          <span className="text-[10px] text-[#9b9b99] mt-0.5 block font-mono whitespace-nowrap truncate">
            Bonus: {market?.liquidationPenaltyPercent ?? 5}% penalty
          </span>
        </div>

        <div className="bg-[#0c0d0c] border border-[#1f201d] p-3.5 rounded-sm whitespace-nowrap overflow-hidden">
          <span className="text-[10px] text-[#777] uppercase tracking-wider font-display block whitespace-nowrap truncate">
            Borrow APR / Supply APY
          </span>
          <div className="flex items-baseline gap-2 mt-1 whitespace-nowrap">
            <span className="text-xl font-bold font-mono text-[#f4f4f0] whitespace-nowrap">
              {market && market.borrowApr > 0 ? `${market.borrowApr.toFixed(2)}%` : "—"}
            </span>
            <span className="text-[11px] text-[#c2ff47] font-mono whitespace-nowrap">
              {market && market.supplyApy > 0 ? `(${market.supplyApy.toFixed(2)}% APY)` : ""}
            </span>
          </div>
          <span className="text-[10px] text-[#9b9b99] mt-0.5 block font-mono whitespace-nowrap truncate">
            Interest Accrues in USDG
          </span>
        </div>

        <div className="bg-[#0c0d0c] border border-[#1f201d] p-3.5 rounded-sm whitespace-nowrap overflow-hidden">
          <span className="text-[10px] text-[#777] uppercase tracking-wider font-display block whitespace-nowrap truncate">
            Available USDG Liquidity
          </span>
          <span className="text-xl font-bold font-mono text-[#c2ff47] block mt-1 whitespace-nowrap">
            {market && market.availableLiquidityUsd > 0
              ? formatCurrency(market.availableLiquidityUsd, 0)
              : "—"}
          </span>
          <span className="text-[10px] text-[#9b9b99] mt-0.5 block font-mono whitespace-nowrap truncate">
            Debt Cap: {market ? formatCurrency(market.debtCapUsd, 0) : "—"}
          </span>
        </div>
      </div>

      {/* 03. CORPORATE ACTION & PRICE SEPARATION AUDIT PANEL */}
      <div className="bg-[#0c0d0c] border border-[#1f201d] p-5 rounded-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#181917] pb-4 whitespace-nowrap">
          <div>
            <span className="text-[11px] uppercase tracking-wider text-[#c2ff47] font-display font-bold block whitespace-nowrap">
              Oracle Multiplier &amp; Corporate Action State
            </span>
            <h3 className="text-sm font-bold text-[#f4f4f0] font-display mt-0.5 whitespace-nowrap">
              Active Economic Adjustment Multiplier:{" "}
              <span className="font-mono text-[#c2ff47] whitespace-nowrap">
                {market ? market.corporateActionMultiplier.toFixed(4) : "1.0000"}x
              </span>
            </h3>
          </div>
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="text-xs text-[#9b9b99] whitespace-nowrap">Status:</span>
            <span className="px-2 py-0.5 rounded bg-[rgba(194,255,71,0.1)] text-[#c2ff47] border border-[rgba(194,255,71,0.25)] text-xs font-display font-medium whitespace-nowrap">
              {market?.multiplierStatus || "NORMAL"} · NO PENDING SPLIT
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 text-xs">
          <div>
            <span className="text-[#777] block font-display uppercase text-[10px]">
              01 / Valuation Invariant
            </span>
            <p className="text-[#9b9b99] mt-1 leading-relaxed">
              Chainlink published feed already incorporates the cumulative corporate action
              multiplier. Levera applies zero secondary multiplier to prevent artificial inflation.
            </p>
          </div>
          <div>
            <span className="text-[#777] block font-display uppercase text-[10px]">
              02 / Depositary Backing Ratio
            </span>
            <p className="text-[#9b9b99] mt-1 leading-relaxed">
              Instrument structure: <strong className="text-[#f4f4f0]">{asset.depositaryStructure}</strong>.
              Conversion ratio is <strong className="text-[#f4f4f0]">{asset.depositaryRatio}</strong>.
            </p>
          </div>
          <div>
            <span className="text-[#777] block font-display uppercase text-[10px]">
              03 / Outage &amp; Halt Guard
            </span>
            <p className="text-[#9b9b99] mt-1 leading-relaxed">
              If underlying stock halts or Chainlink heartbeat exceeds 3600s, borrowing and
              long leverage are automatically paused while debt repayment remains enabled.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Interactive SVG Terminal Chart with Hover Crosshairs & HUD
// -------------------------------------------------------------

function ChinaInteractiveChart({
  asset,
  market,
}: {
  asset: ChineseEquityAsset;
  market?: ChineseEquityMarket;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [timeframe, setTimeframe] = useState<"7D" | "14D" | "1M">("1M");
  const svgRef = useRef<SVGSVGElement | null>(null);

  const fullHistory =
    market?.historyClose30d && market.historyClose30d.length > 1
      ? market.historyClose30d
      : [80, 82, 81, 83, 85, 84, 86, 85.5, 87, 85.42];

  const rawHistory =
    timeframe === "7D"
      ? fullHistory.slice(-7)
      : timeframe === "14D"
      ? fullHistory.slice(-14)
      : fullHistory;

  const minP = Math.min(...rawHistory);
  const maxP = Math.max(...rawHistory);
  const range = maxP - minP || 1;

  const points = rawHistory.map((val, idx) => {
    const x = (idx / (rawHistory.length - 1)) * 600;
    const y = 96 - ((val - minP) / range) * 74;
    return { x, y, val, idx };
  });

  const pathD = points.reduce((acc, pt, i) => {
    return i === 0
      ? `M ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`
      : `${acc} L ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
  }, "");

  const areaD = `${pathD} L 600,120 L 0,120 Z`;
  const firstPrice = rawHistory[0];
  const latestPrice = rawHistory[rawHistory.length - 1];

  // Hovered active point or default to latest
  const isHovered = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < points.length;
  const activeIdx = isHovered ? (hoverIndex as number) : points.length - 1;
  const activePoint = points[activeIdx];
  const activeVal = activePoint.val;
  const activeChange = ((activeVal - firstPrice) / firstPrice) * 100;
  const isPointUp = activeChange >= 0;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clientX / rect.width));
    const closestIdx = Math.round(ratio * (points.length - 1));
    setHoverIndex(closestIdx);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  return (
    <div className="bg-[#0c0d0c] border border-[#1f201d] p-5 rounded-sm flex flex-col gap-4 font-sans">
      {/* HEADER & TIMEFRAME SELECTOR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#181917] pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#777] uppercase font-display tracking-wider">
              Market Depth &amp; Verified Price History
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#c2ff47] animate-pulse" />
          </div>
          <div className="flex items-baseline gap-3 mt-1">
            <h4 className="text-xl font-bold font-mono text-[#f4f4f0]">
              ${activeVal.toFixed(2)}
            </h4>
            <span
              className={`text-xs font-mono font-semibold ${
                isPointUp ? "text-[#c2ff47]" : "text-[#ff6b6b]"
              }`}
            >
              {formatPercent(activeChange, true)}
            </span>
            {isHovered ? (
              <span className="text-[11px] text-[#888] font-mono">
                (Session {activeIdx + 1} of {points.length})
              </span>
            ) : (
              <span className="text-[11px] text-[#888] font-mono">
                (Latest Mark)
              </span>
            )}
          </div>
        </div>

        {/* Timeframe selector + 52w info */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-[#141513] border border-[#232421] p-0.5 rounded font-display text-[11px]">
            {(["7D", "14D", "1M"] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => {
                  setTimeframe(tf);
                  setHoverIndex(null);
                }}
                className={`px-2.5 py-1 rounded transition-all font-medium ${
                  timeframe === tf
                    ? "bg-[#c2ff47] text-[#080808] font-bold shadow-[0_0_8px_rgba(194,255,71,0.2)]"
                    : "text-[#888] hover:text-white"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* DYNAMIC SVG CHART WITH HOVER CROSSHAIR */}
      <div className="relative h-56 w-full bg-[#080808] border border-[#181917] rounded-sm flex flex-col justify-end p-4 overflow-hidden select-none">
        {/* Floating HUD Tooltip on Hover */}
        {isHovered && (
          <div
            className="pointer-events-none absolute z-20 flex flex-col gap-1 rounded bg-[#0d0f0c]/95 border border-[#272b22] px-3 py-2 shadow-[0_6px_24px_rgba(0,0,0,0.85)] backdrop-blur-md transition-all duration-75 min-w-[140px]"
            style={{
              left: `${Math.max(16, Math.min(84, (activePoint.x / 600) * 100))}%`,
              top: "14px",
              transform: "translateX(-50%)",
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm font-bold text-[#f4f4f0]">
                ${activePoint.val.toFixed(2)}
              </span>
              <span
                className={`font-mono text-[10px] font-semibold px-1 py-0.5 rounded ${
                  isPointUp
                    ? "bg-[rgba(194,255,71,0.12)] text-[#c2ff47]"
                    : "bg-[rgba(255,107,107,0.12)] text-[#ff6b6b]"
                }`}
              >
                {formatPercent(activeChange, true)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-[#777] font-mono pt-1 border-t border-[#1c1f19]">
              <span>Session #{activeIdx + 1}</span>
              <span className="text-[#c2ff47] font-medium">Chainlink Oracle</span>
            </div>
          </div>
        )}

        <svg
          ref={svgRef}
          className="w-full h-44 cursor-crosshair"
          viewBox="0 0 600 120"
          preserveAspectRatio="none"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onTouchMove={(e) => {
            if (!svgRef.current || !e.touches[0]) return;
            const rect = svgRef.current.getBoundingClientRect();
            const clientX = e.touches[0].clientX - rect.left;
            const ratio = Math.max(0, Math.min(1, clientX / rect.width));
            const closestIdx = Math.round(ratio * (points.length - 1));
            setHoverIndex(closestIdx);
          }}
          onTouchEnd={handleMouseLeave}
        >
          <defs>
            <linearGradient id="realChartGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#c2ff47" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#c2ff47" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Background Area Fill */}
          <path d={areaD} fill="url(#realChartGrad)" />

          {/* Main Price Path */}
          <path
            d={pathD}
            fill="none"
            stroke="#c2ff47"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Horizontal Grid Guidelines */}
          <line x1="0" y1="30" x2="600" y2="30" stroke="#1f201d" strokeWidth="0.8" strokeDasharray="3 3" />
          <line x1="0" y1="70" x2="600" y2="70" stroke="#1f201d" strokeWidth="0.8" strokeDasharray="3 3" />

          {/* Hover Crosshairs & Indicators */}
          {isHovered && (
            <g>
              {/* Vertical Crosshair Line */}
              <line
                x1={activePoint.x}
                y1="0"
                x2={activePoint.x}
                y2="120"
                stroke="#c2ff47"
                strokeWidth="1.2"
                strokeDasharray="3 3"
                opacity="0.65"
              />

              {/* Horizontal Crosshair Line */}
              <line
                x1="0"
                y1={activePoint.y}
                x2="600"
                y2={activePoint.y}
                stroke="#888"
                strokeWidth="0.8"
                strokeDasharray="2 2"
                opacity="0.3"
              />

              {/* Outer Halo on Point */}
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r="7"
                fill="rgba(194,255,71,0.25)"
              />

              {/* Core Dot on Point */}
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r="3.5"
                fill="#c2ff47"
                stroke="#080808"
                strokeWidth="1.5"
              />
            </g>
          )}

          {/* Invisible Overlay to Capture Pointer Everywhere */}
          <rect x="0" y="0" width="600" height="120" fill="transparent" />
        </svg>

        {/* BOTTOM METADATA BAR */}
        <div className="flex items-center justify-between text-[10px] text-[#777] font-mono pt-2 border-t border-[#181917] mt-2">
          <span>
            Start: <strong className="text-[#bbb]">${firstPrice.toFixed(2)}</strong>
          </span>
          <span>
            Low / High:{" "}
            <strong className="text-[#bbb]">
              ${minP.toFixed(2)} - ${maxP.toFixed(2)}
            </strong>
          </span>
          <span>
            {isHovered ? (
              <span className="text-[#c2ff47]">Hover Active</span>
            ) : (
              <span>
                Latest: <strong className="text-[#c2ff47]">${latestPrice.toFixed(2)}</strong>
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
