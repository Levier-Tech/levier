"use client";

import { AppPage, DataState } from "../../../components/AppPage";
import { PonsMarketTable } from "../../../components/PonsMarketTable";
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

      {isLoading ? (
        <MetricsSkeleton label="Loading Pons markets" />
      ) : error ? (
        <DataState title="Pons data unavailable" retry={refetch}>
          Market data for graduated Pons assets could not be retrieved. No
          placeholder values are substituted.
        </DataState>
      ) : markets.length === 0 ? (
        <DataState title="No graduated assets">
          No Pons assets have graduated yet. Check back after tokens complete
          the bonding curve process.
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
