"use client";
import { useState } from "react";
import Link from "next/link";
import { useAccount, usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { AppPage, DataState } from "../../components/AppPage";
import { PositionSkeleton } from "../../components/LoadingSkeleton";
import { EmptyPriceValue } from "../../components/EmptyPriceValue";
import { MarginHistory } from "../../components/MarginHistory";
import {
  marketDeployments,
  type MarketDeployment,
} from "../../lib/market-deployments";
import { readMarginSnapshot } from "../../lib/margin-client";
import { snapshotClient } from "../../lib/snapshot-client";
import { env } from "../../env.mjs";
import {
  loadStoredChinesePositions,
  saveStoredChinesePositions,
  type ChineseEquityPosition,
} from "../../lib/chinese-equities-client";
import { ChinaPositionsTable } from "../../components/china/ChinaPositionsTable";
const usd = (value: bigint | null) =>
  value === null ? <EmptyPriceValue /> : `$${formatUnits(value, 18)}`;
function MarketPositions({ market }: { market: MarketDeployment }) {
  const { address, chainId } = useAccount(),
    client = usePublicClient();
  const snapshot = useQuery({
    queryKey: ["portfolio", market.margin, address, chainId],
    queryFn: () => {
      if (!client || !address) throw Error("Wallet required");
      return readMarginSnapshot(
        snapshotClient(client),
        market.margin,
        market.long,
        address,
      );
    },
    enabled: !!client && !!address && chainId === env.CHAIN_ID,
    retry: false,
    staleTime: env.UI_POLL_INTERVAL_MS,
  });
  const data = snapshot.data;
  return (
    <section className="app-panel market-overview">
      <div className="lending-history-heading">
        <h2>{market.symbol} positions</h2>
        <button
          className="app-button secondary"
          disabled={snapshot.isFetching}
          onClick={() => void snapshot.refetch()}
        >
          {snapshot.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {snapshot.isError && (
        <DataState
          title="Position verification unavailable"
          retry={() => void snapshot.refetch()}
        >
          The last successful snapshot, if shown, may be out of date.
        </DataState>
      )}
      {!data && !snapshot.isError ? (
        <PositionSkeleton />
      ) : (
        data && (
          <>
            <p className="app-note">
              Verified at block {data.blockNumber.toString()}. Long and direct
              lending share one account; Short is separate.
            </p>
            {([false, true] as const).map((short) => {
              const p = short ? data.shortPosition : data.longPosition,
                d = short ? market.margin.short : market.long;
              const equity =
                p.limits.collateralUsd !== null && p.limits.debtUsd !== null
                  ? p.limits.collateralUsd - p.limits.debtUsd
                  : null;
              return (
                <div className="margin-position-row" key={String(short)}>
                  <div>
                    <h3>
                      {short ? "Short" : "Long / lending"}
                      {p.collateral === 0n && p.debt === 0n
                        ? " · No position"
                        : ""}
                    </h3>
                    <dl className="market-metrics">
                      <div>
                        <dt>Collateral</dt>
                        <dd>
                          {formatUnits(p.collateral, d.collateralDecimals)}{" "}
                          {d.collateralSymbol}
                        </dd>
                      </div>
                      <div>
                        <dt>Debt</dt>
                        <dd>
                          {formatUnits(p.debt, d.debtDecimals)} {d.debtSymbol}
                        </dd>
                      </div>
                      <div>
                        <dt>Position equity</dt>
                        <dd>{usd(equity)}</dd>
                      </div>
                      <div>
                        <dt>Health factor</dt>
                        <dd>
                          {p.debt === 0n ? (
                            "No debt"
                          ) : p.limits.healthFactorBps === null ? (
                            <EmptyPriceValue />
                          ) : (
                            `${formatUnits(p.limits.healthFactorBps, 4)}×`
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Estimated USDG on close</dt>
                        <dd>
                          {data.closeQuotes[short ? 1 : 0] === null ? (
                            <EmptyPriceValue />
                          ) : (
                            `${formatUnits(data.closeQuotes[short ? 1 : 0]!, market.long.debtDecimals)} USDG`
                          )}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              );
            })}
            <p className="app-note">
              Equity excludes wallet balances and is not profit or loss. Closing
              estimates include swap price impact and can change before
              execution.
            </p>
            <Link className="app-button" href={`/trade?asset=${market.symbol}`}>
              Manage {market.symbol} positions ↗
            </Link>
            <Link
              className="text-action"
              href={`/lending?asset=${market.symbol}`}
            >
              Manage direct lending ↗
            </Link>
          </>
        )
      )}
    </section>
  );
}
export default function PortfolioPage() {
  const { address, chainId } = useAccount();
  const [selected, setSelected] = useState(marketDeployments[0]?.symbol ?? "");
  const [chinaPositions, setChinaPositions] = useState<ChineseEquityPosition[]>(() => {
    return loadStoredChinesePositions();
  });

  const handleChinaPositionClosed = (posId: string) => {
    setChinaPositions((prev) => {
      const next = prev.filter((p) => p.id !== posId);
      saveStoredChinesePositions(next);
      return next;
    });
  };

  const handleChinaPositionUpdated = (updatedPos: ChineseEquityPosition) => {
    setChinaPositions((prev) => {
      const next = prev.map((p) => (p.id === updatedPos.id ? updatedPos : p));
      saveStoredChinesePositions(next);
      return next;
    });
  };

  return (
    <AppPage
      eyebrow="Your portfolio"
      title="Your positions, together."
      description="Review collateral, debt and equity across your configured markets and tokenized Chinese equities."
    >
      {/* SECTION 01: TOKENIZED CHINESE EQUITIES (ISOLATED MARGIN) */}
      <div className="app-section-label">
        <span>01 / Tokenized Chinese Equities (Isolated Margin)</span>
      </div>

      <section className="mb-10">
        <ChinaPositionsTable
          positions={chinaPositions}
          onPositionClosed={handleChinaPositionClosed}
          onPositionUpdated={handleChinaPositionUpdated}
        />
      </section>

      {/* SECTION 02: CONFIGURED MARKETS (ON-CHAIN) */}
      <div className="app-section-label">
        <span>02 / US Equities &amp; Configured Markets</span>
      </div>

      {!address ? (
        <DataState title="Connect your wallet">
          Connect to read your actual onchain positions.
        </DataState>
      ) : chainId !== env.CHAIN_ID ? (
        <DataState title="Switch network">
          Switch your wallet to the supported network.
        </DataState>
      ) : !marketDeployments.length ? (
        <DataState title="No configured markets">
          Verified market configuration is required.
        </DataState>
      ) : (
        <>
          <div className="analytics-market-grid">
            {marketDeployments.map((m) => (
              <MarketPositions
                key={`${m.margin.router}:${address}:${chainId}`}
                market={m}
              />
            ))}
          </div>
          <div className="form-field">
            <label htmlFor="portfolio-history-market">History market</label>
            <select
              id="portfolio-history-market"
              className="lending-input"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {marketDeployments.map((m) => (
                <option key={m.symbol}>{m.symbol}</option>
              ))}
            </select>
          </div>
          <MarginHistory
            account={address}
            chainId={chainId}
            symbol={selected}
          />
        </>
      )}
    </AppPage>
  );
}
