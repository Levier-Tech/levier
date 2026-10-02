"use client";
import { useRef, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatUnits, type Address, type Hex } from "viem";
import { env } from "../env.mjs";
import { exactAmount } from "../lib/lending-client";
import { transactionFailure, type TransactionResult } from "../lib/transaction-feedback";
import {
  BPS,
  USDG_DECIMALS,
  closePonsPosition,
  openPonsPosition,
  ponsEnabled,
  ponsRevertReason,
  previewOpen,
  readPonsMarket,
} from "../lib/pons-perp-client";
import { TransactionResultModal } from "./TransactionResultModal";
import { WalletModal } from "./WalletModal";

const usd = (raw: bigint) => Number(formatUnits(raw, USDG_DECIMALS)).toFixed(2);
const price = (raw18: bigint) => {
  const n = Number(formatUnits(raw18, 18));
  return n < 0.0001 ? n.toPrecision(4) : n < 1 ? n.toFixed(6) : n.toFixed(2);
};
const signedUsd = (raw: bigint) => `${raw < 0n ? "-" : "+"}$${usd(raw < 0n ? -raw : raw)}`;

/** Real Pons leverage order form and positions for one listed token (PonsPerpManager). */
export function PonsLeveragePanel({ token, symbol }: { token: Address; symbol: string }) {
  const { address, chainId } = useAccount(),
    client = usePublicClient(),
    { data: wallet } = useWalletClient(),
    queries = useQueryClient();
  const [isLong, setLong] = useState(true),
    [input, setInput] = useState(""),
    [leverageBps, setLeverageBps] = useState(20_000),
    [busy, setBusy] = useState(false),
    [stage, setStage] = useState<string | null>(null),
    [result, setResult] = useState<TransactionResult | null>(null),
    [showWallet, setShowWallet] = useState(false);
  const submitted = useRef<{ hash: Hex; transactionLabel: string }>();
  const onChain = !!address && chainId === env.CHAIN_ID;
  const snapshot = useQuery({
    queryKey: ["pons-market", token, address, chainId],
    queryFn: () => readPonsMarket(client!, token, onChain ? address : undefined),
    enabled: !!client,
    refetchInterval: env.UI_POLL_INTERVAL_MS,
    retry: false,
  });
  const s = snapshot.data;
  const maxLev = s ? s.maxLeverageBps : 20_000;
  const lev = BigInt(Math.min(leverageBps, maxLev));

  let amount: bigint | null = null;
  let issue: string | null = null;
  try {
    if (input) amount = exactAmount(input, USDG_DECIMALS);
  } catch {
    issue = "Enter a valid USDG amount.";
  }
  const preview = s && amount ? previewOpen(amount, lev, BigInt(s.feeBps)) : null;
  if (!issue && s) {
    if (!ponsEnabled) issue = "Pons leverage is not enabled yet.";
    else if (!s.listed) issue = `${symbol} is not listed for leverage.`;
    else if (s.openingPaused) issue = "New positions are paused.";
    else if ("unavailable" in s.prices) issue = s.prices.unavailable;
    else if (preview && preview.size > s.maxPositionSize) issue = `Max position size is $${usd(s.maxPositionSize)}.`;
    else if (preview && s.openInterest + preview.size > s.maxOpenInterest) issue = "Market open-interest cap reached.";
    else if (preview && preview.size > s.freeAssets) issue = "Not enough free LP liquidity.";
    else if (amount && amount > s.usdgBalance) issue = "Your wallet has insufficient USDG.";
  }
  const entry = s && !("unavailable" in s.prices) ? (isLong ? (s.prices.spotUsd > s.prices.twapUsd ? s.prices.spotUsd : s.prices.twapUsd) : s.prices.spotUsd < s.prices.twapUsd ? s.prices.spotUsd : s.prices.twapUsd) : null;
  // Liquidation when equity < maintenance: move = (mm * lev - 1) / lev against the trader.
  const liqMove = s ? Number(BigInt(s.maintenanceMarginBps) * lev - BPS * BPS) / Number(lev * BPS) : 0;
  const liqPrice = entry ? Number(formatUnits(entry, 18)) * (isLong ? 1 + liqMove : 1 - liqMove) : null;

  async function run(label: string, action: () => Promise<Hex>) {
    if (!client || !wallet || !address) return setShowWallet(true);
    setBusy(true);
    submitted.current = undefined;
    setStage(`Confirm ${label} in your wallet`);
    try {
      const hash = await action();
      setResult({ status: "success", title: `${label} confirmed`, description: "The transaction is confirmed onchain.", hash, transactionLabel: label });
      setInput("");
    } catch (error) {
      setResult(transactionFailure(error, submitted.current, ponsRevertReason(error) ?? undefined));
    } finally {
      setBusy(false);
      setStage(null);
      queries.invalidateQueries({ queryKey: ["pons-market"] });
    }
  }
  const onSubmitted = (hash: Hex, transactionLabel: string) => {
    submitted.current = { hash, transactionLabel };
    setStage(`${transactionLabel} submitted, waiting for confirmation`);
  };

  return (
    <>
      <div className="order-panel">
        <div className="order-tabs">
          <button className={`tab ${isLong ? "active long" : ""}`} onClick={() => setLong(true)}>LONG</button>
          <button className={`tab ${!isLong ? "active short" : ""}`} onClick={() => setLong(false)}>SHORT</button>
        </div>
        <p className="text-[11px] text-[var(--muted)] mb-3">
          Experimental, unaudited. Settled in USDG against the Pons LP vault. Max {(maxLev / 10_000).toFixed(1)}x.
        </p>
        <div className="input-group">
          <label>Collateral</label>
          <div className="input-wrapper">
            <input type="number" inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value.trim())} placeholder="0.00" />
            <span className="currency">USDG</span>
          </div>
          {s && onChain && <p className="text-[11px] text-[var(--muted)] mt-1">Wallet: {usd(s.usdgBalance)} USDG</p>}
        </div>
        <div className="input-group">
          <div className="flex justify-between items-center mb-1">
            <label className="!mb-0">Leverage</label>
            <span className="font-mono text-sm font-semibold text-[var(--green)]">{(Number(lev) / 10_000).toFixed(2)}x</span>
          </div>
          <input type="range" min={10_000} max={maxLev} step={2_500} value={Number(lev)} onChange={(e) => setLeverageBps(Number(e.target.value))} className="leverage-slider" />
        </div>
        <div className="order-summary">
          <div className="summary-row"><span>Position size</span><span>${preview ? usd(preview.size) : "0.00"}</span></div>
          <div className="summary-row"><span>Opening fee</span><span>${preview ? usd(preview.fee) : "0.00"}</span></div>
          <div className="summary-row"><span>Entry price</span><span>{entry ? `$${price(entry)}` : "—"}</span></div>
          <div className="summary-row"><span>Liq. price (est.)</span><span style={{ color: "#ff6b6b" }}>{liqPrice ? `$${liqPrice < 0.0001 ? liqPrice.toPrecision(4) : liqPrice.toFixed(6)}` : "—"}</span></div>
          {s && <div className="summary-row"><span>Free LP liquidity</span><span>${usd(s.freeAssets)}</span></div>}
        </div>
        {issue && <p className="text-xs text-[#ff6b6b] mb-2" role="status">{issue}</p>}
        <button
          className={`submit-btn ${isLong ? "long" : "short"}`}
          disabled={busy || (onChain && (!amount || !!issue))}
          onClick={() =>
            !onChain
              ? setShowWallet(true)
              : run(`${isLong ? "Long" : "Short"} ${symbol}`, () =>
                  openPonsPosition({ client: client!, wallet: wallet!, account: address!, token, isLong, collateral: amount!, leverageBps: lev, onSubmitted }),
                )
          }
        >
          {!onChain ? "Connect wallet" : busy ? stage ?? "Working…" : !amount ? "Enter amount" : `Open ${isLong ? "Long" : "Short"}`}
        </button>
      </div>

      {s && onChain && s.positions.length > 0 && (
        <div className="mt-6 w-full">
          <h3 className="text-base font-bold mb-3">Your {symbol} positions</h3>
          <div className="flex flex-col gap-2">
            {s.positions.map((p) => {
              const unlock = Number(p.openedAt) + s.minHoldTime;
              const locked = Date.now() / 1000 < unlock;
              return (
                <div key={String(p.id)} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border border-[var(--line)] bg-white/5 text-sm">
                  <span className={p.isLong ? "pons-positive font-semibold" : "pons-negative font-semibold"}>{p.isLong ? "LONG" : "SHORT"}</span>
                  <span className="font-mono">Size ${usd(p.size)}</span>
                  <span className="font-mono">Collateral ${usd(p.collateral)}</span>
                  <span className="font-mono">Entry ${price(p.entryPrice)}</span>
                  <span className={`font-mono ${p.preview && p.preview.pnl < 0n ? "pons-negative" : "pons-positive"}`}>
                    {p.preview ? `PnL ${signedUsd(p.preview.pnl)}` : "PnL —"}
                  </span>
                  <button
                    className="px-3 py-1.5 rounded-md bg-[var(--green)] text-black text-xs font-semibold disabled:opacity-50"
                    disabled={busy || locked}
                    title={locked ? "Minimum hold time not reached" : undefined}
                    onClick={() => run("Close position", () => closePonsPosition({ client: client!, wallet: wallet!, account: address!, id: p.id, onSubmitted }))}
                  >
                    {locked ? "Locked" : "Close"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <TransactionResultModal result={result} onClose={() => setResult(null)} />
      <WalletModal isOpen={showWallet} onClose={() => setShowWallet(false)} />
    </>
  );
}
