"use client";
import Link from "next/link";
import { useLevierMarkets } from "../../../hooks/useLevierMarkets";
import { useNetworkMode } from "../../../hooks/useNetworkMode";
import { AppPage, DataState } from "../../../components/AppPage";
import { MetricsSkeleton } from "../../../components/LoadingSkeleton";
import { AssetLogo } from "../../../components/AssetLogo";
import { assetCatalog, tradePath } from "../../../lib/asset-catalog";
import { env } from "../../../env.mjs";
import { marketDeployments } from "../../../lib/market-deployments";
import { ConfiguredMarketOverview } from "../../../components/ConfiguredMarketOverview";

export default function MarketDetailPage({
  params,
}: {
  params: { asset: string };
}) {
  const configured = marketDeployments.find(
    (x) => x.symbol === params.asset.toUpperCase(),
  );
  return configured ? (
    <ConfiguredMarketOverview market={configured} />
  ) : (
    <UnconfiguredMarketDetail params={params} />
  );
}

function UnconfiguredMarketDetail({ params }: { params: { asset: string } }) {
  const symbol = params.asset.toUpperCase();
  const asset = assetCatalog.find((entry) => entry.ticker === symbol);
  const { networkMode } = useNetworkMode();
  const { markets, isLoading, error, refetch } = useLevierMarkets(networkMode);
  const market = markets.find(
    (entry) => entry.assetSymbol === symbol || entry.slug === params.asset,
  );
  const title = market ? market.name : asset ? asset.name : "Market not found";
  return (
    <AppPage
      back
      eyebrow="Market overview"
      title={title}
      description="Review this asset and its available market parameters before opening the trade workspace."
    >
      <div className="market-detail-layout">
        <section className="app-panel market-overview">
          <div className="market-identity">
            <AssetLogo
              symbol={market ? market.assetSymbol : symbol}
              size="lg"
            />
            <div>
              <h2>{market ? market.assetSymbol : symbol}</h2>
              <span>Robinhood Chain</span>
            </div>
            <span className="app-badge">
              {isLoading
                ? "Loading"
                : error
                  ? "Data unavailable"
                  : market
                    ? market.status
                    : "Not listed"}
            </span>
          </div>
          {isLoading ? (
            <MetricsSkeleton label="Loading market parameters" />
          ) : error ? (
            <DataState title="Market data unavailable" retry={refetch}>
              Current prices and risk parameters could not be retrieved. No
              estimated values are substituted.
            </DataState>
          ) : !market ? (
            <DataState
              title={asset ? "Market not available yet" : "Unknown market"}
            >
              {asset
                ? "This asset is part of the directory. A configured market is not available on this network."
                : "Check the URL or return to the market directory."}
            </DataState>
          ) : (
            <>
              <dl className="market-metrics">
                {[
                  [
                    "Mark price",
                    `$${market.markPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                  ],
                  ["Borrow APR", `${market.borrowApr}%`],
                  ["Supply APY", `${market.supplyApy}%`],
                  ["Maximum LTV", `${market.maxLtv}%`],
                  ["Liquidation LTV", `${market.liquidationLtv}%`],
                  ["Maximum leverage", `${market.maxLeverage}×`],
                  [
                    "Available liquidity",
                    `$${market.availableLiquidityUsd.toLocaleString()}`,
                  ],
                  [
                    "Total supply",
                    `$${market.totalSupplyUsd.toLocaleString()}`,
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="app-note">
                Market API snapshot. Availability and execution require fresh
                onchain validation; a listed price does not verify a deployment.
              </p>
              {market.pairAddress && (
                <a
                  className="text-action break-all"
                  href={`${env.EXPLORER_URL.replace(/\/$/, "")}/address/${market.pairAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View pair on explorer ↗
                </a>
              )}
            </>
          )}
        </section>
        <aside className="app-panel market-action">
          <span className="app-eyebrow">Your next move</span>
          <h2>Review. Then decide.</h2>
          <p>
            Use the trade workspace to review collateral and exposure. Market
            status and deployment checks determine which actions are available.
          </p>
          {market && !error ? (
            <Link className="app-button" href={tradePath(market.assetSymbol)}>
              Open {market.assetSymbol} trade <span>↗</span>
            </Link>
          ) : (
            <Link className="app-button secondary" href="/markets">
              Explore available markets ↗
            </Link>
          )}
          {symbol === "TSLA" && (
            <Link className="app-button secondary" href="/lending">
              TSLA collateral lending ↗
            </Link>
          )}
          <div className="app-note">
            Borrowing and leverage can lead to liquidation.
          </div>
        </aside>
      </div>
    </AppPage>
  );
}
