"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { env } from "../env.mjs";
import { DataState } from "./AppPage";
import { HistorySkeleton } from "./LoadingSkeleton";
import type { HistoryCursor } from "../lib/lending-history";
import type { MarginHistoryPage } from "../lib/margin-history";
const labels = {
  open: "Open",
  close: "Close",
  approval: "USDG approval",
  operator: "Router permission",
};
export function MarginHistory({
  account,
  chainId,
  symbol,
}: {
  account: Address | undefined;
  chainId: number | undefined;
  symbol: string;
}) {
  const query = useInfiniteQuery({
    queryKey: ["margin-history", account, chainId, symbol],
    initialPageParam: null as HistoryCursor | null,
    queryFn: async ({ pageParam, signal }) => {
      if (!account) throw Error("Wallet required");
      const params = new URLSearchParams({ account, market: symbol });
      if (pageParam) params.set("cursor", JSON.stringify(pageParam));
      const response = await fetch(`/api/margin/history?${params}`, {
        signal,
        cache: "no-store",
      });
      if (!response.ok) throw Error("History unavailable");
      const result = (await response.json()) as MarginHistoryPage;
      if (
        result.account.toLowerCase() !== account.toLowerCase() ||
        result.chainId !== env.CHAIN_ID ||
        result.market !== symbol
      )
        throw Error("History identity mismatch");
      return result;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !!account && !!symbol && chainId === env.CHAIN_ID,
    retry: false,
  });
  const rows = [
    ...new Map(
      query.data?.pages.flatMap((p) => p.rows).map((row) => [row.hash, row]),
    ).values(),
  ];
  return (
    <section
      className="app-panel lending-history"
      aria-labelledby="margin-history-title"
    >
      <div className="lending-history-heading">
        <div>
          <span className="app-eyebrow">Your onchain activity</span>
          <h2 id="margin-history-title">{symbol} trading history</h2>
        </div>
        {account && symbol && chainId === env.CHAIN_ID && (
          <button
            className="app-button secondary"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            {query.isFetching ? "Checking history…" : "Refresh history"}
          </button>
        )}
      </div>
      <p className="app-note">
        Wallet-submitted opens, closes, USDG approvals and router permissions,
        verified against receipts and events. Approvals do not open a position.
        Closed equity is the USDG returned, not profit or loss. External
        liquidations and third-party actions are outside this wallet transaction
        view.
      </p>
      {!account ? (
        <DataState title="Connect your wallet">
          Connect to see your transaction history.
        </DataState>
      ) : chainId !== env.CHAIN_ID ? (
        <DataState title="Switch network">
          Switch your wallet to the supported network to view this market’s
          history.
        </DataState>
      ) : !symbol ? (
        <DataState title="Verified market unavailable">
          History will be available after market configuration is verified.
        </DataState>
      ) : (
        <>
          {query.isPending ? (
            <HistorySkeleton />
          ) : query.isError ? (
            <DataState
              title="History verification unavailable"
              retry={() => void query.refetch()}
            >
              History could not be refreshed. Any rows below are from the last
              successful verification.
            </DataState>
          ) : null}
          {!query.isPending && !query.isError && rows.length === 0 && (
            <DataState title="No trading transactions on this page">
              {query.hasNextPage
                ? "Older transactions may appear on the next page."
                : "No matching trading transactions were found for this wallet."}
            </DataState>
          )}
          {rows.length > 0 && (
            <div
              className="lending-history-scroll"
              tabIndex={0}
              aria-label="Scrollable transaction history"
            >
              <table className="lending-history-table">
                <caption className="sr-only">
                  Margin transactions for the connected wallet
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Action</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Status</th>
                    <th scope="col">Time (UTC)</th>
                    <th scope="col">Gas (ETH)</th>
                    <th scope="col">Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.hash}>
                      <td>
                        {labels[row.action]} {row.side}
                      </td>
                      <td>
                        {row.amount === null
                          ? row.permission
                            ? "Allow router"
                            : "Revoke router"
                          : `${row.amount} USDG`}
                        <small>
                          {row.status === "reverted"
                            ? "Requested only; transaction reverted"
                            : row.amountKind === "margin"
                              ? "Opening margin"
                              : row.amountKind === "returned"
                                ? "Equity returned"
                                : row.amountKind === "minimum"
                                  ? "Minimum return requested"
                                  : row.amountKind === "allowance"
                                    ? "Approval limit"
                                    : "Position management permission"}
                        </small>
                      </td>
                      <td>
                        {row.status === "confirmed"
                          ? "Confirmed"
                          : row.status === "reverted"
                            ? "Reverted"
                            : "Confirming"}
                      </td>
                      <td>
                        <time dateTime={row.timestamp}>
                          {row.timestamp.replace("T", " ").replace(".000Z", "")}
                        </time>
                        <small>Block {row.blockNumber}</small>
                      </td>
                      <td>{row.gasFeeEth}</td>
                      <td>
                        <a
                          className="text-action"
                          href={`${env.EXPLORER_URL.replace(/\/$/, "")}/tx/${row.hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`View ${labels[row.action]} transaction ${row.hash}`}
                        >
                          {row.hash.slice(0, 10)}…{row.hash.slice(-6)} ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {query.hasNextPage && (
            <button
              className="app-button secondary"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetching}
            >
              Load older transactions
            </button>
          )}
          {query.data && (
            <p className="app-note">
              Checked {new Date(query.data.pages[0].checkedAt).toLocaleString()}
              . Explorer discovery can lag behind the chain; use Refresh history
              after confirmation.
            </p>
          )}
        </>
      )}
    </section>
  );
}
