"use client";
import Link from "next/link";
import { usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { env } from "../env.mjs";
import { AppPage, DataState } from "./AppPage";
import { MetricsSkeleton } from "./LoadingSkeleton";
import { AssetLogo } from "./AssetLogo";
import { readMarginSnapshot } from "../lib/margin-client";
import type { MarketDeployment } from "../lib/market-deployments";
import { assetCatalog, tradePath } from "../lib/asset-catalog";

export function ConfiguredMarketOverview({
  market,
}: {
  market: MarketDeployment;
}) {
  const client = usePublicClient();
  const query = useQuery({
    queryKey: ["market-overview", market.symbol, market.margin.router],
    queryFn: () => {
      if (!client) throw Error("PUBLIC_CLIENT_REQUIRED");
      // Owner is an explicit configured address; no wallet balance is presented here.
      return readMarginSnapshot(
        client,
        market.margin,
        market.long,
        market.margin.owner,
      );
    },
    enabled: !!client,
    refetchInterval: env.UI_POLL_INTERVAL_MS,
    retry: false,
  });
  const snapshot = query.isError ? undefined : query.data;
  const asset = assetCatalog.find((x) => x.ticker === market.symbol);
  const status = snapshot
    ? snapshot.paused ||
      snapshot.longPosition.status === 2 ||
      snapshot.shortPosition.status === 2
      ? "Paused"
      : !snapshot.longPosition.oracleAvailable ||
          !snapshot.shortPosition.oracleAvailable
        ? "Fresh prices required"
        : snapshot.longPosition.status === 0 &&
            snapshot.shortPosition.status === 0
          ? "Active"
          : "Reduce only"
    : query.isError
      ? "Data unavailable"
      : "Loading";
  return (
    <AppPage
      back
      eyebrow="Market overview"
      title={asset?.name ?? market.symbol}
      description="Review verified onchain liquidity and market status before choosing your exposure."
    >
      <div className="market-detail-layout">
        <section className="app-panel market-overview">
          <div className="market-identity">
            <AssetLogo symbol={market.symbol} size="lg" />
            <div>
              <h2>{market.symbol} / USDG</h2>
              <span>Robinhood Chain</span>
            </div>
            <span className="app-badge">{status}</span>
          </div>
          {!snapshot && !query.isError ? (
            <MetricsSkeleton label="Loading market parameters" />
          ) : !snapshot ? (
            <DataState
              title="Onchain data unavailable"
              retry={() => void query.refetch()}
            >
              Contract identities, liquidity and oracle availability are checked
              onchain.
            </DataState>
          ) : (
            <>
              <dl className="market-metrics">
                {[
                  [
                    "Long lending liquidity",
                    `${formatUnits(snapshot.longPosition.liquidity, market.long.debtDecimals)} USDG`,
                  ],
                  [
                    "Short lending liquidity",
                    `${formatUnits(snapshot.shortPosition.liquidity, market.long.collateralDecimals)} ${market.symbol}`,
                  ],
                  [
                    "Swap pool stock",
                    `${formatUnits(snapshot.reserves[0], market.long.collateralDecimals)} ${market.symbol}`,
                  ],
                  [
                    "Swap pool USDG",
                    `${formatUnits(snapshot.reserves[1], market.long.debtDecimals)} USDG`,
                  ],
                  [
                    "Maximum USDG margin",
                    `${formatUnits(BigInt(market.margin.policy.maxMarginRaw), market.long.debtDecimals)} USDG`,
                  ],
                  [
                    "Oracle prices",
                    snapshot.longPosition.oracleAvailable &&
                    snapshot.shortPosition.oracleAvailable
                      ? "Available"
                      : "Unavailable",
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd className="break-all">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="app-note">
                Onchain observation at block {snapshot.blockNumber.toString()}.
                Market status, liquidity and fresh prices are checked again
                before an order.
              </p>
            </>
          )}
          <div className="flex flex-col items-start gap-3 mt-5">
            <a
              className="text-action break-all"
              href={`${env.EXPLORER_URL.replace(/\/$/, "")}/address/${market.long.pair}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View Long pair on explorer ↗
            </a>
            <a
              className="text-action break-all"
              href={`${env.EXPLORER_URL.replace(/\/$/, "")}/address/${market.margin.short.pair}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View Short pair on explorer ↗
            </a>
          </div>
        </section>
        <aside className="app-panel market-action">
          <span className="app-eyebrow">Your next move</span>
          <h2>Choose your direction.</h2>
          <p>
            Use USDG margin to open a Long or Short position on {market.symbol}.
            Keep ETH in your wallet for transaction fees.
          </p>
          {market.enabled && env.MARGIN_TRADING_ENABLED ? (
            <Link className="app-button" href={tradePath(market.symbol)}>
              Open {market.symbol} trade ↗
            </Link>
          ) : (
            <DataState title="Execution disabled">
              This market has not been enabled for wallet transactions.
            </DataState>
          )}
          {market.symbol === env.LENDING_DEPLOYMENT_JSON?.collateralSymbol && (
            <Link className="app-button secondary" href="/lending">
              {market.symbol} collateral lending ↗
            </Link>
          )}
          <p className="app-note">
            Available liquidity limits order size. Quotes include swap fees and
            price impact; stale prices or paused markets block new exposure.
          </p>
        </aside>
      </div>
    </AppPage>
  );
}
