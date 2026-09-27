"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  marketDeployments,
  type MarketDeployment,
} from "../../lib/market-deployments";
import { useVerifiedLending } from "../../hooks/useVerifiedLending";
import { Suspense, useRef, useState } from "react";
import { useWalletClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { formatUnits, type Hex } from "viem";
import { AppPage, DataState } from "../../components/AppPage";
import { WorkspaceSkeleton } from "../../components/LoadingSkeleton";
import { LendingHistory } from "../../components/LendingHistory";
import { TransactionResultModal } from "../../components/TransactionResultModal";
import { WalletFunds, useWalletGas } from "../../components/WalletFunds";
import {
  transactionFailure,
  type TransactionResult,
} from "../../lib/transaction-feedback";
import { WalletModal } from "../../components/WalletModal";
import { env } from "../../env.mjs";
import {
  executeLendingAction,
  exactAmount,
  validateAction,
  LendingError,
  type LendingAction,
  type TransactionStage,
} from "../../lib/lending-client";

const labels: Record<LendingAction, string> = {
  deposit: "Deposit collateral",
  borrow: "Borrow USDG",
  repay: "Repay USDG",
  withdraw: "Withdraw collateral",
};
const stages: Record<TransactionStage, string> = {
  CHECKING: "Checking wallet and market",
  APPROVING: "Approve token access in your wallet",
  CONFIRMING_APPROVAL: "Waiting for approval confirmation",
  SIMULATING: "Checking the transaction",
  SIGNING: "Confirm the transaction in your wallet",
  CONFIRMING: "Waiting for transaction confirmation",
  CONFIRMED: "Transaction confirmed",
};
const messages: Record<string, string> = {
  INSUFFICIENT_COLLATERAL_BALANCE:
    "The amount exceeds your wallet stock-token balance. Add collateral tokens or reduce the amount.",
  INSUFFICIENT_USDG:
    "The amount exceeds your wallet USDG balance. Add USDG or reduce the amount.",
  DEPOSIT_CAP_EXCEEDED:
    "The amount exceeds this market’s remaining collateral capacity.",
  BORROW_LIMIT_EXCEEDED:
    "The amount exceeds your borrowing limit, pool liquidity or market cap.",
  WITHDRAW_BREACHES_LTV:
    "Repay more debt before withdrawing this much collateral.",
  ORACLE_UNAVAILABLE:
    "Fresh prices are unavailable. You can still repay debt or withdraw after full repayment.",
  WRONG_NETWORK: "Switch your wallet to the configured Robinhood network.",
  WALLET_CHANGED:
    "Your wallet account or network changed. Review the selected wallet.",
  TOO_MANY_DECIMALS:
    "The amount has more decimal places than this token supports.",
  INVALID_AMOUNT: "Enter a positive amount using digits and a decimal point.",
  REPAY_EXCEEDS_DEBT_OR_BALANCE:
    "The repayment exceeds your outstanding debt or wallet balance.",
  WITHDRAW_EXCEEDS_COLLATERAL:
    "The withdrawal exceeds your deposited collateral.",
  DEPOSIT_UNAVAILABLE:
    "The market is paused or your collateral balance is insufficient.",
  BORROW_UNAVAILABLE:
    "Borrowing is unavailable or the pool has insufficient USDG.",
  TRANSACTION_REPLACED_OR_CANCELLED:
    "The transaction was cancelled or replaced with a different request.",
  TRANSACTION_REVERTED: "The transaction reverted.",
};
function LendingWorkspace({
  market,
}: {
  market: MarketDeployment | undefined;
}) {
  const lendingEnabled = env.LENDING_ENABLED && !!market?.enabled;
  const queryClient = useQueryClient();
  const { address, chainId, client, deployment, snapshot } = useVerifiedLending(
    market?.long ?? null,
  );
  const { data: wallet } = useWalletClient();
  const [action, setAction] = useState<LendingAction>("deposit");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<TransactionStage | null>(null);
  const [hash, setHash] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const submitted = useRef<{ hash: Hex; transactionLabel: string }>();
  const [result, setResult] = useState<TransactionResult | null>(null);
  const gas = useWalletGas(client, address, chainId);
  const [showWallet, setShowWallet] = useState(false);
  const ready =
    lendingEnabled &&
    deployment &&
    wallet &&
    address &&
    client &&
    chainId === env.CHAIN_ID &&
    snapshot.data &&
    !snapshot.isError &&
    gas.data !== undefined &&
    gas.data > 0n &&
    !gas.isError;
  let actionIssue: string | null = null;
  if (snapshot.data && deployment && amount) {
    try {
      validateAction(
        action,
        exactAmount(
          amount,
          action === "deposit" || action === "withdraw"
            ? deployment.collateralDecimals
            : deployment.debtDecimals,
        ),
        snapshot.data,
      );
    } catch (error) {
      actionIssue =
        error instanceof LendingError
          ? (messages[error.code] ??
            "Review the amount and market availability.")
          : "Review the amount.";
    }
  }
  async function submit() {
    if (
      !ready ||
      actionIssue ||
      !deployment ||
      !wallet ||
      !address ||
      !client ||
      lock.current
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setHash(null);
    submitted.current = undefined;
    setResult(null);
    setStage("CHECKING");
    try {
      const confirmed = await executeLendingAction({
        client,
        wallet,
        deployment,
        account: address,
        enabled: lendingEnabled,
        action,
        input: amount,
        confirmations: env.LENDING_RECEIPT_CONFIRMATIONS,
        timeoutMs: env.LENDING_RECEIPT_TIMEOUT_MS,
        onStage: (next, tx) => {
          setStage(next);
          if (tx) {
            setHash(tx);
            submitted.current = {
              hash: tx,
              transactionLabel:
                next === "CONFIRMING_APPROVAL"
                  ? "Token approval transaction"
                  : labels[action],
            };
          }
        },
      });
      setResult({
        status: "success",
        title: `${labels[action]} confirmed`,
        description:
          "The transaction receipt and lending event were verified onchain. Your balances and position are refreshing.",
        hash: confirmed.hash,
        transactionLabel: labels[action],
      });
      setAmount("");
      void snapshot.refetch();
    } catch (caught) {
      const feedback = transactionFailure(
        caught,
        submitted.current,
        caught instanceof LendingError ? messages[caught.code] : undefined,
      );
      setResult(feedback);
      setStage(null);
      setError(feedback.description);
    } finally {
      void queryClient.invalidateQueries({
        queryKey: ["lending-history", address, chainId, deployment.pair],
      });
      void gas.refetch();
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      void queryClient.invalidateQueries({ queryKey: ["margin-position"] });
      lock.current = false;
      setBusy(false);
    }
  }
  const collateralSymbol = deployment?.collateralSymbol;
  const maximum = snapshot.data
    ? snapshot.data.limits[
        (
          {
            deposit: "depositMax",
            borrow: "borrowMax",
            repay: "repayMax",
            withdraw: "withdrawMax",
          } as const
        )[action]
      ]
    : null;
  const amountDecimals =
    action === "deposit" || action === "withdraw"
      ? deployment?.collateralDecimals
      : deployment?.debtDecimals;
  const format = (value: bigint | undefined, decimals: number | undefined) =>
    value !== undefined && decimals !== undefined
      ? formatUnits(value, decimals)
      : "Unavailable";
  let required: bigint | undefined;
  try {
    if (
      amount &&
      amountDecimals !== undefined &&
      (action === "deposit" || action === "repay")
    )
      required = exactAmount(amount, amountDecimals);
  } catch {}
  return (
    <AppPage
      back
      eyebrow="Collateral lending"
      title="Borrow against your assets"
      description="Deposit stock tokens as collateral, borrow USDG, and manage repayment and withdrawals."
    >
      <nav className="trade-market-selector" aria-label="Lending market">
        {marketDeployments.map((m) => (
          <Link
            key={m.symbol}
            href={`/lending?asset=${m.symbol}`}
            aria-current={market?.symbol === m.symbol ? "page" : undefined}
          >
            {m.symbol}
            <small>{m.enabled ? "Configured" : "Execution disabled"}</small>
          </Link>
        ))}
      </nav>
      {deployment &&
      address &&
      chainId === env.CHAIN_ID &&
      !snapshot.data &&
      !snapshot.isError ? (
        <WorkspaceSkeleton label="Loading lending balances and position" />
      ) : (
        <div className="market-detail-layout">
          <section className="app-panel market-overview">
            <span className="app-eyebrow">Your lending position</span>
            <h2>
              {deployment
                ? `${deployment.collateralSymbol} / ${deployment.debtSymbol}`
                : "Market preparation in progress"}
            </h2>
            {!deployment ? (
              <DataState title="Lending is not available yet">
                The market is awaiting verified deployment and price feeds. Your
                wallet funds have not been deposited.
              </DataState>
            ) : !address ? (
              <DataState title="Connect your wallet">
                Connect to read your balances and position on this network.
              </DataState>
            ) : chainId !== env.CHAIN_ID ? (
              <DataState title="Switch network">
                Switch your wallet to the supported network.
              </DataState>
            ) : snapshot.isError ? (
              <DataState
                title="Market verification unavailable"
                retry={() => void snapshot.refetch()}
              >
                The configured market could not be verified. Transactions remain
                unavailable.
              </DataState>
            ) : (
              <dl className="market-metrics">
                <div>
                  <dt>Wallet {collateralSymbol}</dt>
                  <dd>
                    {format(
                      snapshot.data?.collateralBalance,
                      deployment.collateralDecimals,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Wallet USDG</dt>
                  <dd>
                    {format(
                      snapshot.data?.debtBalance,
                      deployment.debtDecimals,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Deposited {collateralSymbol}</dt>
                  <dd>
                    {format(
                      snapshot.data?.collateral,
                      deployment.collateralDecimals,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Debt USDG</dt>
                  <dd>
                    {format(snapshot.data?.debt, deployment.debtDecimals)}
                  </dd>
                </div>
                <div>
                  <dt>Pool USDG available</dt>
                  <dd>
                    {format(snapshot.data?.liquidity, deployment.debtDecimals)}
                  </dd>
                </div>
              </dl>
            )}
            {deployment && !lendingEnabled && (
              <p className="app-note">
                Wallet transactions are awaiting market activation.
              </p>
            )}
            {snapshot.data && (
              <p className="app-note" role="status">
                Market:{" "}
                {snapshot.data.status === 0
                  ? "Active"
                  : snapshot.data.status === 1
                    ? "Restricted"
                    : "Paused"}
                .
                {snapshot.data.oracleAvailable
                  ? " Prices are available onchain."
                  : " Fresh prices are unavailable; borrowing is blocked. Repayment and debt-free withdrawal remain available."}
              </p>
            )}
            <p className="app-note">
              Collateral lending does not buy or sell stock tokens. Long and
              Short require separate trading flows.
            </p>
          </section>
          <section className="app-panel market-action">
            <h2>Manage your position</h2>
            <div className="form-field">
              <label className="app-eyebrow" htmlFor="lending-action">
                Action
              </label>
              <select
                id="lending-action"
                value={action}
                onChange={(e) => setAction(e.target.value as LendingAction)}
                disabled={busy}
                className="lending-input"
              >
                {Object.entries(labels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label className="app-eyebrow" htmlFor="lending-amount">
                Amount{" "}
                {action === "deposit" || action === "withdraw"
                  ? collateralSymbol
                  : "USDG"}
              </label>
              <input
                id="lending-amount"
                aria-invalid={!!actionIssue}
                aria-describedby={
                  actionIssue ? "lending-amount-issue" : undefined
                }
                inputMode="decimal"
                autoComplete="off"
                placeholder="Enter amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={busy || !ready}
                className="lending-input"
              />
            </div>
            {deployment && address && chainId === env.CHAIN_ID && (
              <WalletFunds
                symbol={
                  action === "deposit" || action === "withdraw"
                    ? deployment.collateralSymbol
                    : deployment.debtSymbol
                }
                decimals={amountDecimals!}
                balance={
                  snapshot.isError
                    ? undefined
                    : action === "deposit" || action === "withdraw"
                      ? snapshot.data?.collateralBalance
                      : snapshot.data?.debtBalance
                }
                required={required}
                spending={action === "deposit" || action === "repay"}
                gas={gas.data}
                gasError={gas.isError}
              />
            )}
            {deployment && snapshot.data && (
              <p className="app-note">
                Current limit:{" "}
                {maximum === null || maximum === undefined
                  ? "Unavailable"
                  : format(maximum, amountDecimals)}{" "}
                {action === "deposit" || action === "withdraw"
                  ? collateralSymbol
                  : "USDG"}
                .
                <button
                  className="text-action"
                  disabled={
                    !ready ||
                    busy ||
                    maximum === null ||
                    maximum === undefined ||
                    maximum === 0n
                  }
                  onClick={() => {
                    if (
                      maximum !== null &&
                      maximum !== undefined &&
                      amountDecimals !== undefined
                    )
                      setAmount(formatUnits(maximum, amountDecimals));
                  }}
                >
                  Use limit
                </button>
              </p>
            )}
            {actionIssue && (
              <p id="lending-amount-issue" className="app-note" role="alert">
                {actionIssue}
              </p>
            )}
            {!address ? (
              <button
                className="app-button"
                onClick={() => setShowWallet(true)}
              >
                Connect wallet ↗
              </button>
            ) : (
              <button
                className="app-button"
                disabled={!ready || busy || !amount || !!actionIssue}
                onClick={() => void submit()}
              >
                {busy
                  ? "Transaction in progress"
                  : lendingEnabled
                    ? labels[action]
                    : "Awaiting market activation"}
              </button>
            )}
            {stage && (
              <p role="status" className="app-note">
                {stages[stage]}
              </p>
            )}
            {error && (
              <p role="alert" className="app-note">
                {error}
              </p>
            )}
            {hash && (
              <a
                className="text-action"
                href={`${env.EXPLORER_URL.replace(/\/$/, "")}/tx/${hash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View latest submitted transaction ↗
              </a>
            )}
            {env.NETWORK_MODE === "TESTNET" && (
              <a
                className="text-action"
                href={env.USDG_FAUCET_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                USDG faucet ↗
              </a>
            )}
            <p className="app-note">
              Approvals grant this market access to the entered token amount.
              Borrowing uses your collateral and carries liquidation risk.
            </p>
          </section>
        </div>
      )}
      <LendingHistory
        account={address}
        chainId={chainId}
        pair={deployment?.pair}
      />
      <TransactionResultModal result={result} onClose={() => setResult(null)} />
      <WalletModal isOpen={showWallet} onClose={() => setShowWallet(false)} />
    </AppPage>
  );
}

function LendingRoute() {
  const search = useSearchParams();
  const requested = search.get("asset")?.toUpperCase();
  const market = requested
    ? marketDeployments.find((m) => m.symbol === requested)
    : marketDeployments.find(
        (m) => m.symbol === env.LENDING_DEPLOYMENT_JSON?.collateralSymbol,
      );
  return (
    <LendingWorkspace
      key={market?.long.pair ?? "unconfigured"}
      market={market}
    />
  );
}
export default function LendingPage() {
  return (
    <Suspense fallback={<WorkspaceSkeleton label="Loading lending market" />}>
      <LendingRoute />
    </Suspense>
  );
}
