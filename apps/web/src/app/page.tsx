"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { marketPath } from "../lib/asset-catalog";
import { useNetworkMode } from "../hooks/useNetworkMode";
import { useLevierMarkets } from "../hooks/useLevierMarkets";
import { useLevierVault } from "../hooks/useLevierVault";
import { HeroSection } from "../components/HeroSection";
import { StatBand } from "../components/StatBand";
import { ProductTabs } from "../components/ProductTabs";
import { HowItWorks } from "../components/HowItWorks";
import { ComparisonMatrix } from "../components/ComparisonMatrix";
import { MarketGrid } from "../components/MarketGrid";
import { ClosingCta } from "../components/ClosingCta";
import { FAQSection } from "../components/FAQSection";

export default function HomePage() {
  const { networkMode } = useNetworkMode();
  const { markets, isLoading: isMarketsLoading } =
    useLevierMarkets(networkMode);
  const { vaults } = useLevierVault(networkMode);

  const router = useRouter();
  const openMarket = (ticker: string) => router.push(marketPath(ticker));

  return (
    <div className="w-full">
      {/* 1. HERO SECTION WITH 3D STOCK CARDS */}
      <HeroSection markets={markets} onSelectMarketAsset={openMarket} />

      {/* 2. STAT BAND */}
      <StatBand />

      {/* 3. PRODUCT TABS (BORROW, EARN, LEVERAGE) */}
      <ProductTabs
        markets={markets}
        vaults={vaults}
        onSelectMarket={openMarket}
      />

      {/* 4. HOW IT WORKS */}
      <HowItWorks />

      {/* 5. COMPARISON: LEVIER VS TRADITIONAL DEFI */}
      <ComparisonMatrix />

      {/* 6. MARKET GRID (5-COLUMN TILES WITH LIVE ORACLE PRICES) */}
      <MarketGrid markets={markets} onSelectAsset={openMarket} />

      {/* 7. CLOSING CTA BAND */}
      <ClosingCta />

      {/* 8. FAQ ACCORDION SECTION */}
      <FAQSection />
    </div>
  );
}
