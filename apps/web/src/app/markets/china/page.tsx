"use client";

import React from "react";
import Link from "next/link";
import { AppPage } from "../../../components/AppPage";
import { ChinaMarketTable } from "../../../components/china/ChinaMarketTable";

export default function ChinaMarketsPage() {
  return (
    <AppPage
      back
      eyebrow="Chinese Equities · Robinhood Chain"
      title="Tokenized Chinese Equities"
      description="Access verified tokenized Chinese company exposure through US-listed ADRs on Robinhood Chain, featuring isolated USDG credit, spot swaps, and spot-backed leverage."
    >
      {/* SECTION: PROTOCOL STATS BAR */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-[#0c0d0c] border border-[#1f201d] p-4 rounded-sm mb-8 font-sans whitespace-nowrap">
        <div className="border-r border-[#181917] pr-3 last:border-0 whitespace-nowrap">
          <span className="text-[11px] text-[#9b9b99] uppercase tracking-wider font-display block whitespace-nowrap">
            Total Equity Collateral
          </span>
          <span className="text-lg md:text-xl font-bold font-mono text-[#f4f4f0] block mt-1 whitespace-nowrap">
            $8,750
          </span>
          <span className="text-[10px] text-[#c2ff47] font-mono mt-0.5 block whitespace-nowrap">
            Across 20 Active Retail Wallets
          </span>
        </div>

        <div className="border-r border-[#181917] pr-3 last:border-0 pl-0 md:pl-2 whitespace-nowrap">
          <span className="text-[11px] text-[#9b9b99] uppercase tracking-wider font-display block whitespace-nowrap">
            24h Tokenized Volume
          </span>
          <span className="text-lg md:text-xl font-bold font-mono text-[#f4f4f0] block mt-1 whitespace-nowrap">
            $2,340
          </span>
          <span className="text-[10px] text-[#9b9b99] font-mono mt-0.5 block whitespace-nowrap">
            AMM &amp; RFQ Retail Flow
          </span>
        </div>

        <div className="border-r border-[#181917] pr-3 last:border-0 mt-3 md:mt-0 whitespace-nowrap">
          <span className="text-[11px] text-[#9b9b99] uppercase tracking-wider font-display block whitespace-nowrap">
            Available USDG Liquidity
          </span>
          <span className="text-lg md:text-xl font-bold font-mono text-[#c2ff47] block mt-1 whitespace-nowrap">
            $16,200
          </span>
          <span className="text-[10px] text-[#9b9b99] font-mono mt-0.5 block whitespace-nowrap">
            18.6% Pool Utilization
          </span>
        </div>

        <div className="pl-0 md:pl-2 mt-3 md:mt-0 whitespace-nowrap">
          <span className="text-[11px] text-[#9b9b99] uppercase tracking-wider font-display block whitespace-nowrap">
            Market Session
          </span>
          <div className="flex items-center gap-1.5 mt-1 whitespace-nowrap">
            <span className="w-2 h-2 rounded-full bg-[#c2ff47] animate-pulse shrink-0" />
            <span className="text-sm font-bold font-display text-[#f4f4f0] whitespace-nowrap">
              US Regular Hours
            </span>
          </div>
          <span className="text-[10px] text-[#9b9b99] block mt-0.5 font-mono whitespace-nowrap">
            Closes in 3h 48m · 09:30-16:00 ET
          </span>
        </div>
      </section>

      {/* SECTION 01: ASSET DIRECTORY TABLE */}
      <div className="app-section-label">
        <span>01 / Asset directory &amp; verification matrix</span>
      </div>

      <section className="mb-10">
        <ChinaMarketTable />
      </section>

      {/* SECTION 02: ARCHITECTURE & REGULATORY BOUNDARIES */}
      <div className="app-section-label">
        <span>02 / Product boundaries &amp; investor disclosures</span>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="app-panel border border-[#1f201d] bg-[#0c0d0c] p-5 rounded-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[#c2ff47] font-display font-bold text-sm">
              01
            </span>
            <h3 className="text-sm font-bold font-display text-[#f4f4f0]">
              Exact Tokenholder Entitlement
            </h3>
          </div>
          <p className="text-xs text-[#9b9b99] leading-relaxed">
            Robinhood Stock Tokens are issued by Robinhood Assets (Jersey) Limited as
            contractual security-linked debt securities tracking economic total return.
            Holding a token does not convey direct equity ownership, shareholder voting
            rights, or legal claims on mainland operating subsidiaries.
          </p>
        </div>

        <div className="app-panel border border-[#1f201d] bg-[#0c0d0c] p-5 rounded-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[#c2ff47] font-display font-bold text-sm">
              02
            </span>
            <h3 className="text-sm font-bold font-display text-[#f4f4f0]">
              Isolated Credit &amp; Debt Boundary
            </h3>
          </div>
          <p className="text-xs text-[#9b9b99] leading-relaxed">
            Each Chinese equity market operates under an isolated risk and liquidity pool.
            Collateral deposits in BABA, BIDU, or NIO back isolated debt in USDG; losses
            or liquidations within Chinese equities do not cross-subsidize or impair
            US Equities or Pons module vaults.
          </p>
        </div>

        <div className="app-panel border border-[#1f201d] bg-[#0c0d0c] p-5 rounded-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[#c2ff47] font-display font-bold text-sm">
              03
            </span>
            <h3 className="text-sm font-bold font-display text-[#f4f4f0]">
              Corporate Action &amp; Pricing Multiplier
            </h3>
          </div>
          <p className="text-xs text-[#9b9b99] leading-relaxed">
            Chainlink Tokenized Equity feeds normalize cash dividends and stock splits
            via on-chain multipliers. Raw token units remain immutable in custody, while
            valuations round down for collateral credit and round up for debt obligations
            to protect protocol solvency.
          </p>
        </div>

        <div className="app-panel border border-[#1f201d] bg-[#0c0d0c] p-5 rounded-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[#c2ff47] font-display font-bold text-sm">
              04
            </span>
            <h3 className="text-sm font-bold font-display text-[#f4f4f0]">
              Short Selling Status: Disabled
            </h3>
          </div>
          <p className="text-xs text-[#9b9b99] leading-relaxed">
            Short positions remain strictly disabled under reason code{" "}
            <code className="bg-[#181a17] text-[#c2ff47] px-1 py-0.5 rounded text-[11px] font-mono">
              SHORT_INVENTORY_UNAVAILABLE
            </code>
            . True spot shorting requires separate verified stock borrow inventory and
            transfer approval on Robinhood Chain before activation.
          </p>
        </div>
      </section>
    </AppPage>
  );
}
