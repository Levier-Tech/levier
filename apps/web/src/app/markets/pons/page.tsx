"use client";

import { AppPage, DataState } from "../../../components/AppPage";
import { PonsMarketTable } from "../../../components/PonsMarketTable";
import { PonsVaultPanel } from "../../../components/PonsVaultPanel";
import { MetricsSkeleton } from "../../../components/LoadingSkeleton";
import { usePonsMarkets } from "../../../hooks/usePonsMarkets";

export default function PonsMarketsPage() {
  const { markets, isLoading, isRefetching, error, refetch, lastUpdated } = usePonsMarkets();

  return (
    <AppPage
      back
      eyebrow="Pons Markets"
      title="Pons Graduated Assets"
      description="Tokens that completed the Pons bonding curve and meet liquidity, market cap, and oracle requirements for leverage trading."
    >
      <PonsVaultPanel />

      {isLoading ? (
        <MetricsSkeleton label="Loading Pons markets" />
      ) : error ? (
        <DataState title="Cooking something up" retry={refetch}>
          Pons Market is on the way. Graduated tokens will land here soon.
        </DataState>
      ) : markets.length === 0 ? (
        <DataState title="Cooking something up">
          Pons Market is on the way. Graduated tokens will land here soon.
        </DataState>
      ) : (
        <PonsMarketTable 
          markets={markets} 
          onRefresh={refetch}
          isRefetching={isRefetching}
          lastUpdated={lastUpdated}
        />
      )}

      <section className="app-panel" style={{ marginTop: 24 }}>
        <h2 className="pons-section-title">How it works</h2>
        <div className="pons-how-it-works">
          <div className="pons-step">
            <span className="pons-step-num">01</span>
            <div>
              <strong>Token graduates</strong>
              <p>A token completes the Pons bonding curve and enters the open market.</p>
            </div>
          </div>
          <div className="pons-step">
            <span className="pons-step-num">02</span>
            <div>
              <strong>Eligibility check</strong>
              <p>Levier validates liquidity, volume, market cap, and oracle availability.</p>
            </div>
          </div>
          <div className="pons-step">
            <span className="pons-step-num">03</span>
            <div>
              <strong>Leverage enabled</strong>
              <p>Eligible assets receive per-asset risk configs and become tradeable with leverage.</p>
            </div>
          </div>
        </div>
      </section>
    </AppPage>
  );
}
