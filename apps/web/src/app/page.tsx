"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { marketPath } from "../lib/asset-catalog";
import { useNetworkMode } from "../hooks/useNetworkMode";
import { useLevierMarkets } from "../hooks/useLevierMarkets";
import { useLevierVault } from "../hooks/useLevierVault";
import { HeroSection } from "../components/HeroSection";
import { ProductTabs } from "../components/ProductTabs";
import { MarketGrid } from "../components/MarketGrid";
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

      {/* 2. PRODUCT TABS (BORROW, EARN, LEVERAGE) */}
      <ProductTabs
        markets={markets}
        vaults={vaults}
        onSelectMarket={openMarket}
      />

      {/* 3. MARKET GRID (5-COLUMN TILES WITH LIVE ORACLE PRICES) */}
      <MarketGrid markets={markets} onSelectAsset={openMarket} />

      {/* 4. FAQ ACCORDION SECTION */}
      <FAQSection />
    </div>
  );
}
