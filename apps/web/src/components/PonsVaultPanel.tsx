"use client";
import { useRef, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatUnits, type Hex } from "viem";
import { env } from "../env.mjs";
import { exactAmount } from "../lib/lending-client";
import { transactionFailure, type TransactionResult } from "../lib/transaction-feedback";
import { USDG_DECIMALS, ponsDeployment, ponsRevertReason, ponsVaultAction, readPonsVault } from "../lib/pons-perp-client";
import { TransactionResultModal } from "./TransactionResultModal";
import { WalletModal } from "./WalletModal";

const usd = (raw: bigint) => Number(formatUnits(raw, USDG_DECIMALS)).toFixed(2);

/** LP deposit/withdraw for the USDG vault that backs Pons leverage. Renders nothing before deployment. */
export function PonsVaultPanel() {
  const { address, chainId } = useAccount(),
    client = usePublicClient(),
    { data: wallet } = useWalletClient(),
    queries = useQueryClient();
  const [action, setAction] = useState<"deposit" | "withdraw">("deposit"),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<TransactionResult | null>(null),
    [showWallet, setShowWallet] = useState(false);
  const submitted = useRef<{ hash: Hex; transactionLabel: string }>();
  const onChain = !!address && chainId === env.CHAIN_ID;
  const vault = useQuery({
    queryKey: ["pons-vault", address, chainId],
    queryFn: () => readPonsVault(client!, onChain ? address : undefined),
    enabled: !!client && !!ponsDeployment,
    refetchInterval: env.UI_POLL_INTERVAL_MS,
    retry: false,
  });
  if (!ponsDeployment) return null;
  const v = vault.data;
  let amount: bigint | null = null,
    issue: string | null = null;
  try {
    if (input) amount = exactAmount(input, USDG_DECIMALS);
  } catch {
    issue = "Enter a valid USDG amount.";
  }
  if (!issue && v && amount) {
    if (action === "deposit" && v.depositsPaused) issue = "Deposits are paused.";
    else if (action === "deposit" && amount > v.usdgBalance) issue = "Your wallet has insufficient USDG.";
    else if (action === "withdraw" && amount > v.maxWithdraw) issue = `You can withdraw up to $${usd(v.maxWithdraw)} now.`;
  }

  async function submit() {
    if (!client || !wallet || !address || !amount) return setShowWallet(true);
    setBusy(true);
    submitted.current = undefined;
    try {
      const hash = await ponsVaultAction({
        client,
        wallet,
        account: address,
        action,
        amount,
        onSubmitted: (h, transactionLabel) => (submitted.current = { hash: h, transactionLabel }),
      });
      setResult({ status: "success", title: action === "deposit" ? "Deposit confirmed" : "Withdrawal confirmed", description: "The transaction is confirmed onchain.", hash });
      setInput("");
    } catch (error) {
      setResult(transactionFailure(error, submitted.current, ponsRevertReason(error) ?? undefined));
    } finally {
      setBusy(false);
      queries.invalidateQueries({ queryKey: ["pons-vault"] });
    }
  }

  return (
    <section className="rounded-xl border border-[var(--line)] bg-white/5 p-4 sm:p-5 mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-lg font-bold">Pons LP vault</h2>
        <span className="text-[11px] text-[var(--muted)]">Experimental, unaudited. LPs take the other side of Pons leverage trades.</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-4">
        <div><span className="block text-[10px] uppercase text-[var(--muted)]">TVL</span><span className="font-mono">${v ? usd(v.totalAssets) : "—"}</span></div>
        <div><span className="block text-[10px] uppercase text-[var(--muted)]">Reserved</span><span className="font-mono">${v ? usd(v.reserved) : "—"}</span></div>
        <div><span className="block text-[10px] uppercase text-[var(--muted)]">Free</span><span className="font-mono">${v ? usd(v.freeAssets) : "—"}</span></div>
        <div><span className="block text-[10px] uppercase text-[var(--muted)]">Your LP</span><span className="font-mono">${v && onChain ? usd(v.position) : "—"}</span></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-[var(--line)] overflow-hidden text-xs">
          {(["deposit", "withdraw"] as const).map((a) => (
            <button key={a} className={`px-3 py-2 ${action === a ? "bg-[var(--green)] text-black font-semibold" : ""}`} onClick={() => setAction(a)}>
              {a === "deposit" ? "Deposit" : "Withdraw"}
            </button>
          ))}
        </div>
        <input
          className="flex-1 min-w-0 px-3 py-2 rounded-md bg-black/30 border border-[var(--line)] font-mono text-sm"
          type="number"
          inputMode="decimal"
          placeholder="0.00 USDG"
          value={input}
          onChange={(e) => setInput(e.target.value.trim())}
        />
        <button
          className="px-4 py-2 rounded-md bg-[var(--green)] text-black text-sm font-semibold disabled:opacity-50"
          disabled={busy || (onChain && (!amount || !!issue))}
          onClick={() => (onChain ? submit() : setShowWallet(true))}
        >
          {!onChain ? "Connect wallet" : busy ? "Working…" : action === "deposit" ? "Deposit" : "Withdraw"}
        </button>
      </div>
      {issue && <p className="text-xs text-[#ff6b6b] mt-2" role="status">{issue}</p>}
      <TransactionResultModal result={result} onClose={() => setResult(null)} />
      <WalletModal isOpen={showWallet} onClose={() => setShowWallet(false)} />
    </section>
  );
}
