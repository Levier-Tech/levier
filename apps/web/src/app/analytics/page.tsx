"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { AppPage, DataState } from "../../components/AppPage";
import { AnalyticsSkeleton } from "../../components/LoadingSkeleton";
import { EmptyPriceValue } from "../../components/EmptyPriceValue";
import { env } from "../../env.mjs";
import { analyticsSchema } from "../../lib/analytics";
import { assetCatalog } from "../../lib/asset-catalog";

const quantity = (raw: string, decimals: number) =>
  formatUnits(BigInt(raw), decimals);
const usd = (raw: string | null) =>
  raw === null ? <EmptyPriceValue /> : `$${quantity(raw, 18)}`;
const statusLabels = {
  NORMAL: "Normal",
  REDUCE_ONLY: "Reduce only",
  PAUSED: "Paused",
};
export default function AnalyticsPage() {
  const snapshot = useQuery({
    queryKey: ["onchain-analytics", env.CHAIN_ID],
    queryFn: async () => {
      const response = await fetch("/api/analytics", { cache: "no-store" });
      if (!response.ok) throw Error("Analytics unavailable");
      return analyticsSchema.parse(await response.json());
    },
    refetchInterval: env.UI_POLL_INTERVAL_MS,
    retry: false,
  });
  const data = snapshot.data;
  const configuredSymbols = Object.keys(env.PROTOCOL_ADDRESSES.tokens).filter(
    (x) => x !== "USDG",
  );
  const symbols = Array.from(
    new Set([...configuredSymbols, ...assetCatalog.map((x) => x.ticker)]),
  );
  return (
    <AppPage
      eyebrow="Onchain analytics"
      title="A clearer view of your markets."
      description="Verified collateral, debt and liquidity from the configured lending markets. Every snapshot is tied to a confirmed block."
    >
      <div className="analytics-toolbar">
        <div>
          <span className="app-eyebrow">Verified market scope</span>
          <p className="app-note">
            Long lending and Short are separate markets. Direct lending is
            included in Long totals.
          </p>
        </div>
        <button
          className="app-button secondary"
          disabled={snapshot.isFetching}
          onClick={() => void snapshot.refetch()}
        >
          {snapshot.isFetching ? "Verifying…" : "Refresh snapshot ↗"}
        </button>
      </div>
      {!data && !snapshot.isError ? (
        <AnalyticsSkeleton />
      ) : !data ? (
        <DataState
          title="Analytics unavailable"
          retry={() => void snapshot.refetch()}
        >
          The RPC or configured contracts could not be verified. Missing
          observations are not reported as zero.
        </DataState>
      ) : (
        <>
          {snapshot.isError && (
            <p className="form-warning" role="alert">
              Refresh failed. Values below are the last verified snapshot and
              may be out of date.
            </p>
          )}
          <div className="analytics-provenance">
            <span>
              Block{" "}
              <a
                className="text-action"
                href={`${env.EXPLORER_URL}/block/${data.blockNumber}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {data.blockNumber} ↗
              </a>
            </span>
            <span>
              Block time:{" "}
              {new Date(Number(data.blockTimestamp) * 1000)
                .toISOString()
                .replace("T", " ")
                .replace(".000Z", " UTC")}
            </span>
            <span>
              {data.totals.verifiedMarkets} / {data.totals.configuredMarkets}{" "}
              markets verified
            </span>
          </div>
          <section
            className="analytics-summary"
            aria-label="Configured market totals"
          >
            <article className="app-panel">
              <span className="app-eyebrow">Verified lending markets</span>
              <strong>
                {data.totals.verifiedMarkets} / {data.totals.configuredMarkets}
              </strong>
              <p className="app-note">
                Configuration scope, not every market on the network.
              </p>
            </article>
            <article className="app-panel">
              <span className="app-eyebrow">Normal registry status</span>
              <strong>
                {
                  data.markets.filter((m) => m.metrics?.status === "NORMAL")
                    .length
                }{" "}
                / {data.totals.verifiedMarkets}
              </strong>
              <p className="app-note">
                New borrowing also needs valid prices and available liquidity.
              </p>
            </article>
            <article className="app-panel">
              <span className="app-eyebrow">Deposited collateral</span>
              <strong>{usd(data.totals.collateralUsd18)}</strong>
              <p className="app-note">
                Lending collateral only. Swap reserves are excluded.
              </p>
            </article>
            <article className="app-panel">
              <span className="app-eyebrow">Outstanding lending debt</span>
              <strong>{usd(data.totals.debtUsd18)}</strong>
              <p className="app-note">
                Debt value is not trading volume or open interest.
              </p>
            </article>
          </section>
          <div className="analytics-market-grid">
            {data.markets.map((m) => (
              <section className="app-panel market-overview" key={m.id}>
                <div className="lending-history-heading">
                  <h2>{m.label}</h2>
                  <span className="app-badge">
                    {m.metrics ? statusLabels[m.metrics.status] : "Unverified"}
                  </span>
                </div>
                {!m.metrics ? (
                  <DataState title="Market verification unavailable">
                    This market is excluded from verified totals. Its token
                    balances have not been assumed to be zero.
                  </DataState>
                ) : (
                  <>
                    <p
                      className={
                        m.metrics.collateralPrice18 === null ||
                        m.metrics.debtPrice18 === null
                          ? "form-warning"
                          : "app-note"
                      }
                    >
                      {m.metrics.collateralPrice18 === null ||
                      m.metrics.debtPrice18 === null
                        ? "Fresh oracle prices are unavailable at this block. Token quantities remain visible; price-dependent totals are unavailable."
                        : "Both oracle valuations are available at this block."}
                    </p>
                    <dl className="market-metrics">
                      <div>
                        <dt>Collateral deposited</dt>
                        <dd>
                          {quantity(
                            m.metrics.collateralRaw,
                            m.collateralDecimals,
                          )}{" "}
                          {m.collateralSymbol}
                        </dd>
                      </div>
                      <div>
                        <dt>Debt outstanding</dt>
                        <dd>
                          {quantity(m.metrics.debtRaw, m.debtDecimals)}{" "}
                          {m.debtSymbol}
                        </dd>
                      </div>
                      <div>
                        <dt>Available to borrow</dt>
                        <dd>
                          {quantity(m.metrics.liquidityRaw, m.debtDecimals)}{" "}
                          {m.debtSymbol}
                        </dd>
                      </div>
                      <div>
                        <dt>Borrow utilisation</dt>
                        <dd>
                          {m.metrics.utilizationBps === null
                            ? "No debt inventory"
                            : `${m.metrics.utilizationBps / 100}%`}
                        </dd>
                      </div>
                      <div>
                        <dt>Maximum LTV</dt>
                        <dd>{quantity(m.metrics.maxLtvBps, 2)}%</dd>
                      </div>
                      <div>
                        <dt>Liquidation LTV</dt>
                        <dd>{quantity(m.metrics.liquidationLtvBps, 2)}%</dd>
                      </div>
                      <div>
                        <dt>{m.collateralSymbol} collateral valuation</dt>
                        <dd>{usd(m.metrics.collateralPrice18)}</dd>
                      </div>
                      <div>
                        <dt>{m.debtSymbol} debt valuation</dt>
                        <dd>{usd(m.metrics.debtPrice18)}</dd>
                      </div>
                    </dl>
                    {m.metrics.utilizationBps !== null && (
                      <div
                        className="analytics-utilisation"
                        role="meter"
                        aria-label={`${m.label} borrow utilisation`}
                        aria-valuenow={m.metrics.utilizationBps / 100}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <span
                          style={{
                            width: `${m.metrics.utilizationBps / 100}%`,
                          }}
                        />
                      </div>
                    )}
                    <p className="app-note">
                      Utilisation = debt borrowed ÷ (debt borrowed + available
                      debt-token liquidity). Oracle values follow each market’s
                      collateral/debt valuation policy.
                    </p>
                  </>
                )}
                <a
                  className="text-action"
                  href={`${env.EXPLORER_URL}/address/${m.pair}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Inspect lending contract ↗
                </a>
              </section>
            ))}
          </div>
          {data.pools.map((pool) => (
            <section className="app-panel market-overview" key={pool.address}>
              <h2>
                {pool.stockSymbol} / {pool.stableSymbol} swap liquidity
              </h2>
              {pool.reserves ? (
                <dl className="market-metrics">
                  <div>
                    <dt>{pool.stockSymbol} reserve</dt>
                    <dd>
                      {quantity(pool.reserves.stockRaw, pool.stockDecimals)}
                    </dd>
                  </div>
                  <div>
                    <dt>{pool.stableSymbol} reserve</dt>
                    <dd>
                      {quantity(pool.reserves.stableRaw, pool.stableDecimals)}
                    </dd>
                  </div>
                  <div>
                    <dt>Margin router</dt>
                    <dd>
                      {pool.reserves.routerPaused ? "Paused" : "Unpaused"}
                    </dd>
                  </div>
                  <div>
                    <dt>Registry authorization</dt>
                    <dd>
                      {pool.reserves.routerAuthorized
                        ? "Authorized"
                        : "Not authorized"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <DataState title="Swap pool verification unavailable">
                  Reserves could not be verified against the configured pool
                  identity.
                </DataState>
              )}
              <p className="app-note">
                Swap reserves are separate from lending collateral. A funded
                pool alone does not make a market ready to trade.
              </p>
              <a
                className="text-action"
                href={`${env.EXPLORER_URL}/address/${pool.address}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Inspect swap pool ↗
              </a>
            </section>
          ))}
        </>
      )}
      <section className="app-panel market-overview">
        <h2>Market expansion readiness</h2>
        <p className="app-note">
          A directory entry or configured token is not an active lending market.
          New assets need verified issuance, prices, lending contracts and swap
          liquidity.
        </p>
        <div className="analytics-coverage">
          {symbols.map((symbol) => {
            const deployed = data?.markets.some(
              (m) => m.collateralSymbol === symbol || m.debtSymbol === symbol,
            );
            return (
              <div key={symbol}>
                <strong>{symbol}</strong>
                <span>
                  {!data
                    ? "Awaiting market verification"
                    : deployed
                      ? "Deployed · see live status above"
                      : configuredSymbols.includes(symbol)
                        ? "Token configured · market deployment pending"
                        : "Token and market verification pending"}
                </span>
              </div>
            );
          })}
        </div>
        <Link href="/markets" className="text-action">
          Explore the asset directory ↗
        </Link>
      </section>
      <section className="app-panel market-overview">
        <h2>Position risk and historical analytics</h2>
        <p className="app-note">
          Active-account counts, liquidation heatmaps, historical volume and
          P&amp;L require complete indexing of both lending pairs and router
          events. These metrics are not available in this snapshot. No example
          positions or fixed price assumptions are displayed.
        </p>
        <Link href="/trade?asset=TSLA" className="text-action">
          View your actual Long / Short positions ↗
        </Link>
      </section>
    </AppPage>
  );
}
