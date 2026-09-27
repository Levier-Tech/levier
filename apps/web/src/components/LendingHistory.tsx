"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { env } from "../env.mjs";
import { DataState } from "./AppPage";
import { HistorySkeleton } from "./LoadingSkeleton";
import type { HistoryCursor, LendingHistoryPage } from "../lib/lending-history";
const labels = {
  deposit: "Deposit collateral",
  borrow: "Borrow",
  repay: "Repay",
  withdraw: "Withdraw collateral",
  approval: "Token approval",
};
export function LendingHistory({
  account,
  chainId,
  pair,
}: {
  account: Address | undefined;
  chainId: number | undefined;
  pair: Address | undefined;
}) {
  const query = useInfiniteQuery({
    queryKey: ["lending-history", account, chainId, pair],
    initialPageParam: null as HistoryCursor | null,
    queryFn: async ({ pageParam, signal }) => {
      if (!account) throw Error("Wallet required");
      const params = new URLSearchParams({
        account,
        ...(pair ? { pair } : {}),
      });
      if (pageParam) params.set("cursor", JSON.stringify(pageParam));
      const response = await fetch(`/api/lending/history?${params}`, {
        signal,
        cache: "no-store",
      });
      if (!response.ok) throw Error("History unavailable");
      const result = (await response.json()) as LendingHistoryPage;
      if (
        result.account.toLowerCase() !== account.toLowerCase() ||
        result.chainId !== env.CHAIN_ID
      )
        throw Error("History identity mismatch");
      return result;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !!account && !!pair && chainId === env.CHAIN_ID,
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
      aria-labelledby="lending-history-title"
    >
      <div className="lending-history-heading">
        <div>
          <span className="app-eyebrow">Your onchain activity</span>
          <h2 id="lending-history-title">Transaction history</h2>
        </div>
        {account && pair && chainId === env.CHAIN_ID && (
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
        Direct lending transactions and token approvals for this market, checked
        against onchain receipts. Approvals grant token access and do not move
        funds. Recently submitted transactions may take time to appear.
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
      ) : !pair ? (
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
            <DataState title="No lending transactions on this page">
              {query.hasNextPage
                ? "Older transactions may appear on the next page."
                : "No matching lending transactions were found for this wallet."}
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
                  Lending transactions for the connected wallet
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
                      <td>{labels[row.action]}</td>
                      <td>
                        {row.amount} {row.symbol}
                        {row.amountKind === "requested" && (
                          <small>Requested; transaction reverted</small>
                        )}
                        {row.amountKind === "allowance" && (
                          <small>Approval limit</small>
                        )}
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
