"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import {
  chineseEquitiesCatalog,
  chineseEquitiesMarkets,
  chinaMarketPath,
  formatPercent,
  formatUnderlyingPrice,
  type ChineseEquityAsset,
  type ChineseEquityMarket,
} from "../../lib/chinese-equities-client";

type FilterTrack = "ALL" | "US_LISTED_ADR" | "HONG_KONG_CANDIDATE" | "MAINLAND_A_SHARE";
type StatusFilter = "ALL" | "VERIFIED_NATIVE_IDENTITY" | "VERIFIED_EXTERNAL_PRODUCT" | "RESEARCH_ONLY";

export function ChinaMarketTable() {
  const [selectedTrack, setSelectedTrack] = useState<FilterTrack>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const trackCounts = useMemo(() => {
    return {
      all: chineseEquitiesCatalog.length,
      adr: chineseEquitiesCatalog.filter((a) => a.track === "US_LISTED_ADR").length,
      hk: chineseEquitiesCatalog.filter((a) => a.track === "HONG_KONG_CANDIDATE").length,
      ashare: chineseEquitiesCatalog.filter((a) => a.track === "MAINLAND_A_SHARE").length,
    };
  }, []);

  const filteredItems = useMemo(() => {
    return chineseEquitiesCatalog.filter((asset) => {
      // Track filter
      if (selectedTrack !== "ALL" && asset.track !== selectedTrack) {
        return false;
      }
      // Status filter
      if (statusFilter !== "ALL" && asset.verificationStatus !== statusFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTicker = asset.ticker.toLowerCase().includes(q);
        const matchName = asset.name.toLowerCase().includes(q);
        const matchCompany = asset.company.toLowerCase().includes(q);
        if (!matchTicker && !matchName && !matchCompany) return false;
      }
      return true;
    });
  }, [selectedTrack, statusFilter, searchQuery]);

  return (
    <div className="flex flex-col gap-6">
      {/* FILTER & SEARCH TOOLBAR */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0e0f0e] border border-[#1f201d] p-4 rounded-sm">
        {/* Track Filter Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 font-display text-xs">
          <button
            onClick={() => setSelectedTrack("ALL")}
            className={`px-3 py-1.5 rounded transition-all whitespace-nowrap ${
              selectedTrack === "ALL"
                ? "bg-[#c2ff47] text-[#080808] font-bold shadow-[0_0_10px_rgba(194,255,71,0.2)]"
                : "text-[#9b9b99] hover:text-white bg-[#161715] border border-[#292a27]"
            }`}
          >
            All Candidates ({trackCounts.all})
          </button>
          <button
            onClick={() => setSelectedTrack("US_LISTED_ADR")}
            className={`px-3 py-1.5 rounded transition-all whitespace-nowrap ${
              selectedTrack === "US_LISTED_ADR"
                ? "bg-[#c2ff47] text-[#080808] font-bold shadow-[0_0_10px_rgba(194,255,71,0.2)]"
                : "text-[#9b9b99] hover:text-white bg-[#161715] border border-[#292a27]"
            }`}
          >
            US ADRs ({trackCounts.adr})
          </button>
          <button
            onClick={() => setSelectedTrack("HONG_KONG_CANDIDATE")}
            className={`px-3 py-1.5 rounded transition-all whitespace-nowrap ${
              selectedTrack === "HONG_KONG_CANDIDATE"
                ? "bg-[#c2ff47] text-[#080808] font-bold shadow-[0_0_10px_rgba(194,255,71,0.2)]"
                : "text-[#9b9b99] hover:text-white bg-[#161715] border border-[#292a27]"
            }`}
          >
            Hong Kong xStocks ({trackCounts.hk})
          </button>
          <button
            onClick={() => setSelectedTrack("MAINLAND_A_SHARE")}
            className={`px-3 py-1.5 rounded transition-all whitespace-nowrap ${
              selectedTrack === "MAINLAND_A_SHARE"
                ? "bg-[#c2ff47] text-[#080808] font-bold shadow-[0_0_10px_rgba(194,255,71,0.2)]"
                : "text-[#9b9b99] hover:text-white bg-[#161715] border border-[#292a27]"
            }`}
          >
            Mainland A-Shares ({trackCounts.ashare})
          </button>
        </div>

        {/* Search & Verification Filter */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-60">
            <input
              type="text"
              placeholder="Search ticker, company..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#080808] border border-[#292a27] rounded px-3 py-1.5 text-xs text-[#f4f4f0] placeholder-[#666] focus:outline-none focus:border-[#c2ff47] transition-colors font-sans"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2 text-[#777] hover:text-white"
                aria-label="Clear search"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="bg-[#080808] border border-[#292a27] rounded px-2.5 py-1.5 text-xs text-[#9b9b99] focus:outline-none focus:border-[#c2ff47] font-display"
          >
            <option value="ALL">All Categories</option>
            <option value="VERIFIED_NATIVE_IDENTITY">Robinhood Chain Native</option>
            <option value="VERIFIED_EXTERNAL_PRODUCT">External Tokenized Products</option>
            <option value="RESEARCH_ONLY">Research Pipeline</option>
          </select>
        </div>
      </div>

      {/* DESKTOP TABLE VIEW */}
      <div className="hidden lg:block overflow-x-auto border border-[#1f201d] rounded-sm bg-[#0c0d0c]">
        <table className="w-full text-left border-collapse font-sans text-xs">
          <thead>
            <tr className="border-b border-[#1f201d] bg-[#111] text-[#9b9b99] font-display tracking-wider uppercase text-[11px] whitespace-nowrap">
              <th className="py-3 px-4 whitespace-nowrap">Instrument &amp; Structure</th>
              <th className="py-3 px-4 whitespace-nowrap">Underlying Ref</th>
              <th className="py-3 px-4 whitespace-nowrap">Token Ref Price</th>
              <th className="py-3 px-4 whitespace-nowrap">24h Change</th>
              <th className="py-3 px-4 whitespace-nowrap">Market Status</th>
              <th className="py-3 px-4 whitespace-nowrap">Capabilities</th>
              <th className="py-3 px-4 text-right whitespace-nowrap">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#181917]">
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-[#9b9b99] whitespace-nowrap">
                  No Chinese equity candidates matching current filters.
                </td>
              </tr>
            ) : (
              filteredItems.map((asset) => {
                const market = chineseEquitiesMarkets.find(
                  (m) => m.assetSymbol === asset.ticker
                );
                return (
                  <MarketTableRow key={asset.assetId} asset={asset} market={market} />
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* MOBILE / TABLET CARD VIEW */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:hidden gap-4">
        {filteredItems.length === 0 ? (
          <div className="col-span-full py-12 text-center text-[#9b9b99] bg-[#0c0d0c] border border-[#1f201d] rounded p-6">
            No Chinese equity candidates matching current filters.
          </div>
        ) : (
          filteredItems.map((asset) => {
            const market = chineseEquitiesMarkets.find(
              (m) => m.assetSymbol === asset.ticker
            );
            return <MarketCardView key={asset.assetId} asset={asset} market={market} />;
          })
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Row Component
// -------------------------------------------------------------

function MarketTableRow({
  asset,
  market,
}: {
  asset: ChineseEquityAsset;
  market?: ChineseEquityMarket;
}) {
  const isNative = asset.verificationStatus === "VERIFIED_NATIVE_IDENTITY";
  const isExternal = asset.verificationStatus === "VERIFIED_EXTERNAL_PRODUCT";
  const isUp = (market?.priceChange24hPercent ?? 0) >= 0;

  return (
    <tr className="hover:bg-[#121411] transition-colors group">
      {/* Instrument & Structure */}
      <td className="py-3.5 px-4 whitespace-nowrap">
        <div className="flex items-center gap-3 whitespace-nowrap">
          <div className="w-8 h-8 rounded bg-[#181a17] border border-[#292a27] flex items-center justify-center font-display font-bold text-[#c2ff47] text-xs shrink-0">
            {asset.ticker.slice(0, 3)}
          </div>
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="font-bold text-[#f4f4f0] text-sm group-hover:text-[#c2ff47] transition-colors font-display tracking-wide shrink-0">
              {asset.ticker}
            </span>
            <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-[#1b1d19] border border-[#2a2d26] text-[#c8cbc0] font-display shrink-0">
              {asset.instrumentType}
            </span>
            {isNative ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(194,255,71,0.1)] text-[#c2ff47] border border-[rgba(194,255,71,0.25)] font-display font-medium shrink-0">
                Native 4663
              </span>
            ) : isExternal ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(245,166,35,0.12)] text-[#f5a623] border border-[rgba(245,166,35,0.25)] font-display shrink-0">
                External
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#222] text-[#888] border border-[#333] font-display shrink-0">
                Research
              </span>
            )}
            <span className="text-[#555] text-xs shrink-0">·</span>
            <span className="text-xs text-[#9b9b99] font-normal shrink-0">
              {asset.name}
            </span>
            <span className="text-[11px] text-[#666] shrink-0">
              ({asset.underlyingExchange})
            </span>
          </div>
        </div>
      </td>

      {/* Underlying Reference */}
      <td className="py-3.5 px-4 font-mono text-[#d1d4cb] whitespace-nowrap">
        {market && market.underlyingReferencePrice > 0 ? (
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="font-semibold text-white">
              {formatUnderlyingPrice(market.underlyingReferencePrice, market.underlyingCurrency)}
            </span>
            <span className="text-[11px] text-[#777]">
              ({asset.underlyingExchange} Tape)
            </span>
          </div>
        ) : (
          <span className="text-[#666] font-mono">—</span>
        )}
      </td>

      {/* Token Reference Price */}
      <td className="py-3.5 px-4 font-mono whitespace-nowrap">
        {market && market.tokenReferencePriceUsd > 0 ? (
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-[#f4f4f0] font-semibold">
              ${market.tokenReferencePriceUsd.toFixed(2)}
            </span>
            <span className="text-[11px] text-[#9b9b99]">
              USDG
            </span>
          </div>
        ) : (
          <span className="text-[#666] font-mono">—</span>
        )}
      </td>

      {/* 24h Change */}
      <td className="py-3.5 px-4 font-mono whitespace-nowrap">
        {market && market.priceChange24hPercent !== 0 ? (
          <span
            className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap ${
              isUp
                ? "text-[#c2ff47] bg-[rgba(194,255,71,0.08)]"
                : "text-[#ff6b6b] bg-[rgba(255,107,107,0.08)]"
            }`}
          >
            {formatPercent(market.priceChange24hPercent, true)}
          </span>
        ) : (
          <span className="text-[#666] font-mono">—</span>
        )}
      </td>

      {/* Market Status */}
      <td className="py-3.5 px-4 whitespace-nowrap">
        {market?.status === "NORMAL" ? (
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-[#c2ff47] animate-pulse shrink-0" />
            <span className="text-xs font-display font-medium text-[#c2ff47]">Active</span>
            <span className="text-[#555] text-xs">·</span>
            <span className="text-[11px] text-[#9b9b99] font-mono">Regular Hours</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-[#777] shrink-0" />
            <span className="text-xs font-display text-[#999]">Research</span>
            <span className="text-[#555] text-xs">·</span>
            <span className="text-[11px] text-[#666] font-mono">Pipeline</span>
          </div>
        )}
      </td>

      {/* Capabilities */}
      <td className="py-3.5 px-4 whitespace-nowrap">
        <div className="flex items-center gap-1.5 font-mono text-[10px] whitespace-nowrap">
          {market?.capabilities.spot ? (
            <span className="px-1.5 py-0.5 rounded bg-[#182412] text-[#c2ff47] border border-[#2d471e] shrink-0">
              Spot
            </span>
          ) : null}
          {market?.capabilities.borrow ? (
            <span className="px-1.5 py-0.5 rounded bg-[#182412] text-[#c2ff47] border border-[#2d471e] shrink-0">
              Borrow
            </span>
          ) : null}
          {market?.capabilities.long ? (
            <span className="px-1.5 py-0.5 rounded bg-[#182412] text-[#c2ff47] border border-[#2d471e] shrink-0">
              Long {market.maxLeverage}x
            </span>
          ) : null}
          <span
            title="Short inventory unavailable"
            className="px-1.5 py-0.5 rounded bg-[#181816] text-[#777] border border-[#252522] shrink-0"
          >
            Short Off
          </span>
        </div>
      </td>

      {/* Action */}
      <td className="py-3.5 px-4 text-right whitespace-nowrap">
        <Link
          href={chinaMarketPath(asset.ticker)}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-[#1a1c18] hover:bg-[#c2ff47] text-[#c8cbc0] hover:text-[#080808] border border-[#2f332a] hover:border-[#c2ff47] font-display font-medium text-xs transition-all whitespace-nowrap"
        >
          <span>{market?.capabilities.spot ? "Trade / Borrow" : "Inspect"}</span>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </td>
    </tr>
  );
}

// -------------------------------------------------------------
// Card View (Mobile / Tablet)
// -------------------------------------------------------------

function MarketCardView({
  asset,
  market,
}: {
  asset: ChineseEquityAsset;
  market?: ChineseEquityMarket;
}) {
  const isNative = asset.verificationStatus === "VERIFIED_NATIVE_IDENTITY";
  const isExternal = asset.verificationStatus === "VERIFIED_EXTERNAL_PRODUCT";
  const isUp = (market?.priceChange24hPercent ?? 0) >= 0;

  return (
    <div className="bg-[#0c0d0c] border border-[#1f201d] hover:border-[#2f3329] p-4 rounded-sm flex flex-col justify-between gap-4 transition-colors">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded bg-[#181a17] border border-[#292a27] flex items-center justify-center font-display font-bold text-[#c2ff47] text-sm shrink-0">
              {asset.ticker.slice(0, 3)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-[#f4f4f0] text-base font-display">
                  {asset.ticker}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1b1d19] border border-[#2a2d26] text-[#aaa] font-display">
                  {asset.instrumentType}
                </span>
              </div>
              <span className="text-xs text-[#9b9b99] block mt-0.5">{asset.name}</span>
            </div>
          </div>
          {isNative ? (
            <span className="text-[10px] px-2 py-0.5 rounded bg-[rgba(194,255,71,0.1)] text-[#c2ff47] border border-[rgba(194,255,71,0.25)] font-display font-medium">
              Native 4663
            </span>
          ) : isExternal ? (
            <span className="text-[10px] px-2 py-0.5 rounded bg-[rgba(245,166,35,0.12)] text-[#f5a623] border border-[rgba(245,166,35,0.25)] font-display">
              External
            </span>
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#222] text-[#888] border border-[#333] font-display">
              Research
            </span>
          )}
        </div>

        {/* Pricing Rows */}
        <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-[#181917] font-mono text-xs">
          <div>
            <span className="text-[10px] text-[#777] block uppercase font-sans whitespace-nowrap">
              Token Price (Chainlink)
            </span>
            <span className="text-sm font-bold text-[#f4f4f0] whitespace-nowrap">
              {market && market.tokenReferencePriceUsd > 0
                ? `$${market.tokenReferencePriceUsd.toFixed(2)}`
                : "—"}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-[#777] block uppercase font-sans whitespace-nowrap">
              Underlying Reference
            </span>
            <span className="text-sm text-[#bbb] whitespace-nowrap">
              {market && market.underlyingReferencePrice > 0
                ? formatUnderlyingPrice(market.underlyingReferencePrice, market.underlyingCurrency)
                : "—"}
            </span>
          </div>
        </div>

        {/* 24h Change & Status */}
        <div className="flex items-center justify-between mt-3 text-xs whitespace-nowrap">
          <div className="whitespace-nowrap">
            <span className="text-[10px] text-[#777] block whitespace-nowrap">24h Change</span>
            {market && market.priceChange24hPercent !== 0 ? (
              <span
                className={`font-mono text-xs font-semibold whitespace-nowrap ${
                  isUp ? "text-[#c2ff47]" : "text-[#ff6b6b]"
                }`}
              >
                {formatPercent(market.priceChange24hPercent, true)}
              </span>
            ) : (
              <span className="text-[#666] font-mono whitespace-nowrap">—</span>
            )}
          </div>
          <div className="text-right whitespace-nowrap">
            <span className="text-[10px] text-[#777] block whitespace-nowrap">Status</span>
            <span className="font-mono text-[11px] text-[#c2ff47] whitespace-nowrap">
              {market?.status === "NORMAL" ? "Active" : "Research Pipeline"}
            </span>
          </div>
        </div>
      </div>

      <Link
        href={chinaMarketPath(asset.ticker)}
        className="w-full flex items-center justify-center gap-1 py-2 rounded bg-[#181a16] hover:bg-[#c2ff47] text-[#c8cbc0] hover:text-[#080808] border border-[#2f332a] hover:border-[#c2ff47] font-display font-medium text-xs transition-all whitespace-nowrap"
      >
        <span>Open Market Workspace</span>
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </Link>
    </div>
  );
}
