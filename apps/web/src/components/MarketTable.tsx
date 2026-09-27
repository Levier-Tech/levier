"use client";

import React, { useState } from "react";
import Link from "next/link";
import { marketPath } from "../lib/asset-catalog";
import { ArrowUpRight } from "lucide-react";
import { MarketConfig } from "@levera/types";
import { AssetLogo } from "./AssetLogo";

interface MarketTableProps {
  markets: MarketConfig[];
  isLoading?: boolean;
}

export function MarketTable({ markets, isLoading }: MarketTableProps) {
  const [activeCategory, setActiveCategory] = useState<string>("All");

  const categories = ["All", "Equities", "ETFs"];

  const filteredMarkets = markets.filter((m) => {
    if (activeCategory === "All") return true;
    return m.category === activeCategory;
  });

  return (
    <div className="w-full space-y-4 font-sans">
      {/* Category Tabs */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-3 text-xs overflow-x-auto no-scrollbar">
        {categories.map((cat) => (
          <button
            key={cat}
            aria-pressed={activeCategory === cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 sm:px-4 py-2 rounded-sm text-[11px] uppercase tracking-widest font-bold whitespace-nowrap transition-all ${
              activeCategory === cat
                ? "bg-brand text-white"
                : "bg-surface text-muted hover:text-white border border-white/10"
            }`}
          >
            [{cat}]
          </button>
        ))}
      </div>

      {/* Table Container */}
      <div className="bg-surface border border-white/10 rounded-sm overflow-hidden">
        <div className="overflow-x-auto touch-scroll">
          <table className="w-full text-left text-xs tabular-nums min-w-[680px] sm:min-w-[760px]">
            <thead className="bg-surface-subtle text-[10px] text-muted font-bold uppercase tracking-widest border-b border-white/10">
              <tr>
                <th className="py-3.5 px-3 sm:px-4 md:px-6 font-sans">MARKET ASSET</th>
                <th className="py-3.5 px-3 sm:px-4 md:px-6">MARK PRICE</th>
                <th className="py-3.5 px-3 sm:px-4 md:px-6">SUPPLY APY</th>
                <th className="py-3.5 px-3 sm:px-4 md:px-6">BORROW APR</th>
                <th className="py-3.5 px-3 sm:px-4 md:px-6">MAX LTV</th>
                <th className="py-3.5 px-3 sm:px-4 md:px-6">TOTAL SUPPLY</th>
                <th className="py-3.5 px-3 sm:px-4 md:px-6">LIQUIDITY</th>
                <th className="py-3.5 px-3 sm:px-4 md:px-6 text-right font-sans">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 text-gray-200">
              {isLoading ? (
                /* Loading Shimmer Skeleton Rows */
                [1, 2, 3, 4, 5].map((i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="py-3.5 px-3 sm:px-4 md:px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-white/10 shrink-0" />
                        <div className="space-y-1.5">
                          <div className="h-3.5 w-24 bg-white/10 rounded-xs" />
                          <div className="h-2.5 w-14 bg-white/5 rounded-xs" />
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-3 sm:px-4 md:px-6">
                      <div className="h-3.5 w-16 bg-white/10 rounded-xs" />
                    </td>
                    <td className="py-3.5 px-3 sm:px-4 md:px-6">
                      <div className="h-3.5 w-14 bg-brand/20 rounded-xs" />
                    </td>
                    <td className="py-3.5 px-3 sm:px-4 md:px-6">
                      <div className="h-3.5 w-14 bg-[#FFB800]/20 rounded-xs" />
                    </td>
                    <td className="py-3.5 px-3 sm:px-4 md:px-6">
                      <div className="h-3.5 w-10 bg-white/5 rounded-xs" />
                    </td>
                    <td className="py-3.5 px-3 sm:px-4 md:px-6">
                      <div className="h-3.5 w-16 bg-white/5 rounded-xs" />
                    </td>
                    <td className="py-3.5 px-3 sm:px-4 md:px-6">
                      <div className="h-3.5 w-16 bg-white/5 rounded-xs" />
                    </td>
                    <td className="py-3.5 px-3 sm:px-4 md:px-6 text-right">
                      <div className="h-7 w-20 bg-white/10 rounded-sm ml-auto" />
                    </td>
                  </tr>
                ))
              ) : filteredMarkets.length === 0 ? (
                /* Empty State */
                <tr>
                  <td
                    colSpan={8}
                    className="py-16 text-center text-xs font-sans text-muted"
                  >
                    <div className="flex flex-col items-center justify-center gap-2">
                      <span className="text-white font-bold tracking-wider">
                        [NO ACTIVE MARKETS FOUND]
                      </span>
                      <span className="text-[11px] text-muted-dark">
                        No tokenized lending pairs available for category &quot;
                        {activeCategory}&quot;.
                      </span>
                      {activeCategory !== "All" && (
                        <button
                          onClick={() => setActiveCategory("All")}
                          className="mt-3 px-3 py-1.5 text-[10px] bg-surface-subtle border border-white/15 hover:border-brand text-white rounded-sm uppercase tracking-wider transition-colors"
                        >
                          VIEW ALL MARKETS
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                /* Live Markets Rows */
                filteredMarkets.map((market) => (
                  <tr
                    key={market.id}
                    className="hover:bg-[#121412] transition-colors group"
                  >
                    <td className="py-3.5 px-3 sm:px-4 md:px-6 font-sans whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <AssetLogo symbol={market.assetSymbol} size="md" />
                        <div>
                          <div className="font-bold text-white text-sm group-hover:text-brand transition-colors uppercase">
                            {market.name}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-muted mt-0.5 font-sans">
                            <span>[{market.category}]</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-3 sm:px-4 md:px-6 font-sans font-bold text-white text-sm whitespace-nowrap">
                      ${market.markPrice.toFixed(2)}
                    </td>
                    <td className="py-3.5 px-3 sm:px-4 md:px-6 font-sans font-bold text-brand whitespace-nowrap">
                      +{market.supplyApy.toFixed(2)}%
                    </td>
                    <td className="py-3.5 px-3 sm:px-4 md:px-6 font-sans font-bold text-[#FFB800] whitespace-nowrap">
                      {market.borrowApr.toFixed(2)}%
                    </td>
                    <td className="py-3.5 px-3 sm:px-4 md:px-6 font-sans text-muted whitespace-nowrap">
                      {market.maxLtv.toFixed(0)}%
                    </td>
                    <td className="py-3.5 px-3 sm:px-4 md:px-6 font-sans text-muted whitespace-nowrap">
                      ${(market.totalSupplyUsd / 1000).toFixed(0)}K
                    </td>
                    <td className="py-3.5 px-3 sm:px-4 md:px-6 font-sans text-muted whitespace-nowrap">
                      ${(market.availableLiquidityUsd / 1000).toFixed(0)}K
                    </td>
                    <td className="py-3.5 px-3 sm:px-4 md:px-6 text-right font-sans whitespace-nowrap">
                      <Link
                        href={marketPath(market.assetSymbol)}
                        className="px-3 sm:px-4 py-2 bg-brand hover:bg-brand-hover text-white text-[11px] font-sans font-bold uppercase tracking-wider rounded-sm transition-all inline-flex items-center gap-1 shadow-sm"
                      >
                        <span>View market</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
