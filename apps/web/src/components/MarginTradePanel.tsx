"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatUnits, type Hex } from "viem";
import { env } from "../env.mjs";
import { DataState } from "./AppPage";
import { WorkspaceSkeleton } from "./LoadingSkeleton";
import { EmptyPriceValue } from "./EmptyPriceValue";
import { TransactionResultModal } from "./TransactionResultModal";
import { WalletFunds, useWalletGas } from "./WalletFunds";
import { exactAmount } from "../lib/lending-client";
import {
  transactionFailure,
  type TransactionResult,
} from "../lib/transaction-feedback";
import { MarginHistory } from "./MarginHistory";
import { WalletModal } from "./WalletModal";
import {
  executeMarginAction,
  readMarginSnapshot,
  marginOrder,
  assertMarginOpeningAvailable,
  type MarginDeployment,
} from "../lib/margin-client";
import type { LendingDeployment } from "../lib/lending-client";
import type { MarketDeployment } from "../lib/market-deployments";
export function MarginTradePanel({ market }: { market: MarketDeployment }) {
  const { address, chainId } = useAccount(),
    client = usePublicClient(),
    { data: wallet } = useWalletClient(),
    queries = useQueryClient();
  const d = market.margin,
    long = market.long;
  const [isShort, setShort] = useState(false),
    [input, setInput] = useState(""),
    [multiple, setMultiple] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [stage, setStage] = useState<string | null>(null),
    [hash, setHash] = useState<Hex | null>(null),
    [error, setError] = useState<string | null>(null),
    [showWallet, setShowWallet] = useState(false);
  const lock = useRef(false);
  const submitted = useRef<{ hash: Hex; transactionLabel: string }>();
  const signingLabel = useRef("");
  const [result, setResult] = useState<TransactionResult | null>(null);
  const gas = useWalletGas(client, address, chainId);
  const snapshot = useQuery({
    queryKey: ["margin-position", d, address, chainId],
    queryFn: () => {
      if (!client || !d || !long || !address) throw Error();
      return readMarginSnapshot(client, d, long, address);
    },
    enabled: !!client && !!d && !!long && !!address && chainId === env.CHAIN_ID,
    refetchInterval: env.UI_POLL_INTERVAL_MS,
    retry: false,
  });
  if (!d || !long)
    return (
      <DataState title="Margin deployment unavailable">
        Verified Long/Short contracts are required.
      </DataState>
    );
  const choices = isShort
    ? d.policy.shortExposureBps
    : d.policy.longLeveragesBps;
  const exposure =
    multiple !== null && choices.includes(multiple) ? multiple : choices[0];
  const canRead =
    address && chainId === env.CHAIN_ID && snapshot.data && !snapshot.isError;
  let preview: ReturnType<typeof marginOrder> | null = null,
    issue: string | null = null;
  const errors: Record<string, string> = {
    INSUFFICIENT_USDG: "Your wallet has insufficient USDG for this margin.",
    GAS_LIMIT_EXCEEDED:
      "The gas estimate exceeds the configured transaction limit.",
    MARKET_UNAVAILABLE: "This market is not currently accepting new positions.",
    ROUTER_PAUSED:
      "New positions are temporarily paused. A confirmed approval remains valid; wait for trading to resume before retrying.",
    MARKET_PAUSED:
      "This side of the market is temporarily closed to new borrowing. Wait for trading to resume.",
    OPERATOR_NOT_CONFIRMED:
      "Router permission could not be verified. Check the approval transaction before retrying.",
    APPROVAL_NOT_CONFIRMED:
      "USDG approval could not be verified. Check the approval transaction before retrying.",
    QUOTE_EXPIRED: "The quote expired. Refresh the quote before retrying.",
    QUOTE_CHANGED:
      "The price moved beyond your slippage limit. Refresh the quote before retrying.",
    CLOSE_UNAVAILABLE:
      "Closing requires sufficient swap liquidity and positive remaining equity.",
    EXISTING_POSITION:
      "Close the existing position on this side before opening another.",
    MARGIN_LIMIT_EXCEEDED: `Maximum margin for this pool is ${formatUnits(BigInt(d.policy.maxMarginRaw), long.debtDecimals)} USDG.`,
    BORROW_LIQUIDITY_UNAVAILABLE:
      "The lending pool has insufficient tokens for this order.",
    ORACLE_UNAVAILABLE: "Fresh oracle prices are unavailable.",
    POOL_UNAVAILABLE: "Swap liquidity is unavailable.",
    WALLET_CHANGED: "Your wallet account or network changed.",
    EXECUTION_DISABLED: "Margin trading has not been activated.",
    AMOUNT_TOO_SMALL: "This amount is too small after token rounding.",
    INVALID_AMOUNT: "Enter a positive amount.",
    TOO_MANY_DECIMALS: "USDG supports at most six decimal places.",
  };
  let openingIssue: string | null = null;
  if (canRead) {
    try {
      assertMarginOpeningAvailable(snapshot.data!, isShort);
    } catch (e) {
      openingIssue =
        errors[e instanceof Error ? e.message : ""] ??
        "New positions are currently unavailable.";
    }
  }
  if (canRead && input)
    try {
      preview = marginOrder(d, long, snapshot.data!, isShort, input, exposure);
    } catch (e) {
      issue =
        errors[e instanceof Error ? e.message : ""] ??
        "This amount cannot be quoted. Review the market and input.";
    }
  async function execute(action: "open" | "close", side: boolean) {
    if (
      !d ||
      !long ||
      !client ||
      !wallet ||
      !address ||
      !canRead ||
      lock.current
    )
      return;
    lock.current = true;
    setBusy(true);
    setHash(null);
    submitted.current = undefined;
    setResult(null);
    setError(null);
    try {
      const confirmed = await executeMarginAction({
        client,
        wallet,
        deployment: d,
        long,
        account: address,
        enabled: env.MARGIN_TRADING_ENABLED && market.enabled,
        isShort: side,
        action,
        input,
        multipleBps: exposure,
        confirmations: env.LENDING_RECEIPT_CONFIRMATIONS,
        timeoutMs: env.LENDING_RECEIPT_TIMEOUT_MS,
        onStage: (text, tx) => {
          setStage(text);
          if (tx) {
            setHash(tx);
            submitted.current = {
              hash: tx,
              transactionLabel: signingLabel.current || "Submitted transaction",
            };
          } else signingLabel.current = text;
        },
      });
      setResult({
        status: "success",
        title: `${side ? "Short" : "Long"} position ${action === "open" ? "opened" : "closed"}`,
        description:
          "The transaction receipt, position event and account state were verified onchain. Your position is refreshing.",
        hash: confirmed,
        transactionLabel: `${action === "open" ? "Open" : "Close"} ${side ? "Short" : "Long"}`,
      });
      if (action === "open") setInput("");
    } catch (e) {
      const feedback = transactionFailure(
        e,
        submitted.current,
        errors[e instanceof Error ? e.message : ""],
      );
      setResult(feedback);
      setStage(null);
      setError(feedback.description);
    } finally {
      lock.current = false;
      setBusy(false);
      void snapshot.refetch();
      void gas.refetch();
      void queries.invalidateQueries({ queryKey: ["verified-lending"] });
      void queries.invalidateQueries({ queryKey: ["lending-history"] });
      void queries.invalidateQueries({ queryKey: ["margin-history"] });
      void queries.invalidateQueries({ queryKey: ["portfolio"] });
    }
  }
  let required: bigint | undefined;
  try {
    if (input) required = exactAmount(input, long.debtDecimals);
  } catch {}
  const gasReady = gas.data !== undefined && gas.data > 0n && !gas.isError;
  if (
    address &&
    chainId === env.CHAIN_ID &&
    !snapshot.data &&
    !snapshot.isError
  )
    return <WorkspaceSkeleton label="Loading balances and trading markets" />;
  return (
    <>
      <div className="market-detail-layout">
        <section className="app-panel market-overview">
          <span className="app-eyebrow">{long.collateralSymbol} / USDG</span>
          <h2>Long or Short with USDG</h2>
          <p className="app-note">
            Long buys {long.collateralSymbol} with your margin and borrowed
            USDG. Short borrows {long.collateralSymbol}, sells it, and holds
            USDG as collateral. Both use the funded Uniswap V2 pool.
          </p>
          {!address ? (
            <DataState title="Connect your wallet">
              Your balances and positions are read onchain.
            </DataState>
          ) : chainId !== env.CHAIN_ID ? (
            <DataState title="Switch network">
              Switch your wallet to the supported network.
            </DataState>
          ) : snapshot.isError ? (
            <DataState
              title="Contract verification unavailable"
              retry={() => void snapshot.refetch()}
            >
              Transactions stay unavailable until contracts can be verified.
            </DataState>
          ) : !snapshot.data ? (
            <DataState title="Reading markets">
              Verifying lending pairs and swap liquidity.
            </DataState>
          ) : (
            <dl className="market-metrics">
              <div>
                <dt>Wallet USDG</dt>
                <dd>
                  {formatUnits(
                    snapshot.data.longPosition.debtBalance,
                    long.debtDecimals,
                  )}
                </dd>
              </div>
              <div>
                <dt>Swap pool USDG</dt>
                <dd>
                  {formatUnits(snapshot.data.reserves[1], long.debtDecimals)}
                </dd>
              </div>
              <div>
                <dt>Swap pool {long.collateralSymbol}</dt>
                <dd>
                  {formatUnits(
                    snapshot.data.reserves[0],
                    long.collateralDecimals,
                  )}
                </dd>
              </div>
              <div>
                <dt>New positions</dt>
                <dd>
                  {!env.MARGIN_TRADING_ENABLED || !market.enabled
                    ? "Trading has not been activated"
                    : (openingIssue ??
                      `${isShort ? "Short" : "Long"} available`)}
                </dd>
              </div>
            </dl>
          )}
          <p className="app-note">
            Pool limit: maximum margin{" "}
            {formatUnits(BigInt(d.policy.maxMarginRaw), long.debtDecimals)} USDG
            per order. Swap fee 0.30% per swap; quotes include price impact.
            Slippage limit {d.policy.slippageBps / 100}%.
          </p>
          <p className="app-note">
            Long shares your {long.collateralSymbol} lending account. One
            aggregate position per side; close returns remaining equity in USDG.
            Keep ETH for gas.
          </p>
        </section>
        <section className="app-panel market-action">
          <h2>Open a position</h2>
          {openingIssue && (
            <p className="app-note" role="status">
              {openingIssue}
            </p>
          )}
          <div className="form-field">
            <label className="app-eyebrow" htmlFor="margin-side">
              Direction
            </label>
            <select
              id="margin-side"
              className="lending-input"
              value={isShort ? "short" : "long"}
              disabled={busy}
              onChange={(e) => {
                setShort(e.target.value === "short");
                setMultiple(null);
              }}
            >
              <option value="long">Long {long.collateralSymbol}</option>
              <option value="short">Short {long.collateralSymbol}</option>
            </select>
          </div>
          <div className="form-field">
            <label className="app-eyebrow" htmlFor="margin-amount">
              Margin (USDG)
            </label>
            <input
              id="margin-amount"
              aria-invalid={!!issue}
              aria-describedby={issue ? "margin-amount-issue" : undefined}
              className="lending-input"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Enter USDG margin"
              value={input}
              disabled={busy || !canRead}
              onChange={(e) => setInput(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="app-eyebrow" htmlFor="margin-multiple">
              {isShort ? "Short exposure / margin" : "Long exposure / margin"}
            </label>
            <select
              id="margin-multiple"
              className="lending-input"
              value={exposure}
              disabled={busy}
              onChange={(e) => setMultiple(Number(e.target.value))}
            >
              {choices.map((x) => (
                <option key={x} value={x}>
                  {x / 10000}×
                </option>
              ))}
            </select>
          </div>
          {address && chainId === env.CHAIN_ID && (
            <WalletFunds
              symbol={long.debtSymbol}
              decimals={long.debtDecimals}
              balance={
                canRead ? snapshot.data!.longPosition.debtBalance : undefined
              }
              required={required}
              spending
              gas={gas.data}
              gasError={gas.isError}
            />
          )}
          {preview && (
            <dl className="market-metrics">
              <div>
                <dt>Borrow</dt>
                <dd>
                  {formatUnits(
                    preview.debt,
                    isShort ? long.collateralDecimals : long.debtDecimals,
                  )}{" "}
                  {isShort ? long.collateralSymbol : "USDG"}
                </dd>
              </div>
              <div>
                <dt>Quoted collateral</dt>
                <dd>
                  {formatUnits(
                    preview.collateral,
                    isShort ? long.debtDecimals : long.collateralDecimals,
                  )}{" "}
                  {isShort ? "USDG" : long.collateralSymbol}
                </dd>
              </div>
              <div>
                <dt>Minimum collateral</dt>
                <dd>
                  {formatUnits(
                    preview.minCollateral,
                    isShort ? long.debtDecimals : long.collateralDecimals,
                  )}{" "}
                  {isShort ? "USDG" : long.collateralSymbol}
                </dd>
              </div>
            </dl>
          )}
          {issue && (
            <p id="margin-amount-issue" className="app-note" role="alert">
              {issue}
            </p>
          )}
          {!address ? (
            <button className="app-button" onClick={() => setShowWallet(true)}>
              Connect wallet
            </button>
          ) : (
            <button
              className="app-button"
              disabled={
                busy ||
                !wallet ||
                !canRead ||
                !preview ||
                !gasReady ||
                !env.MARGIN_TRADING_ENABLED ||
                !market.enabled
              }
              onClick={() => void execute("open", isShort)}
            >
              {busy
                ? "Transaction in progress"
                : isShort
                  ? "Open Short"
                  : "Open Long"}
            </button>
          )}
          <p className="app-note">
            Your wallet may request an exact USDG approval and permission for
            this router to manage your position. The quoted exposure can differ
            after fees and price impact.
          </p>
          {stage && (
            <p className="app-note" role="status">
              {stage}
            </p>
          )}
          {error && (
            <p className="app-note" role="alert">
              {error}
            </p>
          )}
          {hash && (
            <a
              className="text-action"
              target="_blank"
              rel="noopener noreferrer"
              href={`${env.EXPLORER_URL}/tx/${hash}`}
            >
              View submitted transaction ↗
            </a>
          )}
        </section>
      </div>
      {canRead && (
        <section className="app-panel lending-history">
          <h2>Your {long.collateralSymbol} positions</h2>
          <p className="app-note">
            Close repays the full debt using collateral and returns remaining
            USDG. A close must have enough swap liquidity and positive equity.
          </p>
          {([false, true] as const).map((side) => {
            const p = side
              ? snapshot.data!.shortPosition
              : snapshot.data!.longPosition;
            const closeQuote = snapshot.data!.closeQuotes[side ? 1 : 0];
            return (
              <div className="margin-position-row" key={String(side)}>
                <div>
                  <h3>
                    {side ? "Short" : `Long / ${long.collateralSymbol} lending`}
                  </h3>
                  <p className="app-note">
                    Collateral:{" "}
                    {formatUnits(
                      p.collateral,
                      side ? long.debtDecimals : long.collateralDecimals,
                    )}{" "}
                    {side ? "USDG" : long.collateralSymbol} · Debt:{" "}
                    {formatUnits(
                      p.debt,
                      side ? long.collateralDecimals : long.debtDecimals,
                    )}{" "}
                    {side ? long.collateralSymbol : "USDG"}
                  </p>
                  <p className="app-note">
                    Health factor:{" "}
                    {p.debt === 0n ? (
                      "No debt"
                    ) : p.limits.healthFactorBps === null ? (
                      <EmptyPriceValue />
                    ) : (
                      `${formatUnits(p.limits.healthFactorBps, 4)}×`
                    )}{" "}
                    · Estimated return on close:{" "}
                    {closeQuote === null ? (
                      <EmptyPriceValue />
                    ) : (
                      `${formatUnits(closeQuote, long.debtDecimals)} USDG`
                    )}
                  </p>
                </div>
                <button
                  className="app-button secondary"
                  disabled={
                    busy ||
                    !market.enabled ||
                    !env.MARGIN_TRADING_ENABLED ||
                    !gasReady ||
                    !wallet ||
                    p.collateral === 0n ||
                    closeQuote === null ||
                    closeQuote === 0n
                  }
                  onClick={() => void execute("close", side)}
                >
                  Close {side ? "Short" : "Long"}
                </button>
              </div>
            );
          })}
          <Link
            href={`/lending?asset=${market.symbol}`}
            className="text-action"
          >
            Manage direct {long.collateralSymbol} lending ↗
          </Link>
        </section>
      )}
      <MarginHistory
        account={address}
        chainId={chainId}
        symbol={market.symbol}
      />
      <TransactionResultModal result={result} onClose={() => setResult(null)} />
      <WalletModal isOpen={showWallet} onClose={() => setShowWallet(false)} />
    </>
  );
}
