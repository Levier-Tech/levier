import { isSupportedChainId } from "./networks";
import {
  decodeFunctionData,
  decodeEventLog,
  erc20Abi,
  formatUnits,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { MarginRouterABI } from "../contracts/generated/margin";
import { LevierPairABI } from "../contracts/generated/lending";
import {
  discoverWalletTransactions,
  HistoryError,
  type HistoryCursor,
} from "./lending-history";
import type { MarketDeployment } from "./market-deployments";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export type MarginHistoryRow = {
  hash: Hex;
  action: "open" | "close" | "approval" | "operator";
  side: "Long" | "Short" | null;
  symbol: string;
  amount: string | null;
  amountKind: "margin" | "returned" | "minimum" | "allowance" | "permission";
  permission: boolean | null;
  status: "confirmed" | "confirming" | "reverted";
  blockNumber: string;
  timestamp: string;
  gasFeeEth: string;
};
export type MarginHistoryPage = {
  account: Address;
  chainId: number;
  market: string;
  rows: MarginHistoryRow[];
  nextCursor: HistoryCursor | null;
  checkedAt: string;
};
export async function verifyMarginHistoryTransaction(
  client: PublicClient,
  market: MarketDeployment,
  account: Address,
  hash: Hex,
  head: bigint,
  confirmations: number,
): Promise<MarginHistoryRow | null> {
  const { margin: d, long } = market;
  const tx = await client.getTransaction({ hash });
  if (!tx.to || !same(tx.from, account) || tx.value !== 0n) return null;
  let action: MarginHistoryRow["action"],
    side: MarginHistoryRow["side"] = null;
  let amountKind: MarginHistoryRow["amountKind"],
    requested: bigint | null = null,
    permission: boolean | null = null;
  let openDebt: bigint | null = null,
    minCollateral: bigint | null = null;
  try {
    if (same(tx.to, d.router)) {
      const call = decodeFunctionData({ abi: MarginRouterABI, data: tx.input });
      if (call.functionName !== "open" && call.functionName !== "close")
        return null;
      action = call.functionName;
      side = call.args[0] ? "Short" : "Long";
      requested = call.args[1];
      amountKind = action === "open" ? "margin" : "minimum";
      if (call.functionName === "open") {
        openDebt = call.args[2];
        minCollateral = call.args[3];
      }
    } else if (same(tx.to, long.debt)) {
      const call = decodeFunctionData({ abi: erc20Abi, data: tx.input });
      if (call.functionName !== "approve" || !same(call.args[0], d.router))
        return null;
      action = "approval";
      requested = call.args[1];
      amountKind = "allowance";
    } else if (same(tx.to, long.pair) || same(tx.to, d.short.pair)) {
      const call = decodeFunctionData({ abi: LevierPairABI, data: tx.input });
      if (call.functionName !== "setOperator" || !same(call.args[0], d.router))
        return null;
      action = "operator";
      permission = call.args[1];
      amountKind = "permission";
      side = same(tx.to, d.short.pair) ? "Short" : "Long";
    } else return null;
  } catch {
    return null;
  }
  const r = await client.getTransactionReceipt({ hash });
  if (
    !same(tx.hash, hash) ||
    !same(r.transactionHash, hash) ||
    !same(r.from, account) ||
    !r.to ||
    !same(r.to, tx.to) ||
    r.blockNumber !== tx.blockNumber ||
    r.blockNumber > head
  )
    throw new HistoryError("RECEIPT_IDENTITY_MISMATCH");
  const block = await client.getBlock({ blockNumber: r.blockNumber });
  if (block.hash !== r.blockHash || tx.blockHash !== r.blockHash)
    throw new HistoryError("RECEIPT_REORGED");
  let amount = requested;
  if (r.status === "success") {
    let matches = 0;
    for (const log of r.logs) {
      if (!same(log.address, tx.to)) continue;
      let event;
      try {
        event = decodeEventLog({
          abi:
            action === "approval"
              ? erc20Abi
              : action === "operator"
                ? LevierPairABI
                : MarginRouterABI,
          data: log.data,
          topics: log.topics,
        });
      } catch {
        continue;
      }
      if (
        action === "approval" &&
        event.eventName === "Approval" &&
        same(event.args.owner, account) &&
        same(event.args.spender, d.router) &&
        event.args.value === requested
      )
        matches++;
      if (
        action === "operator" &&
        event.eventName === "OperatorApproval" &&
        same(event.args.user, account) &&
        same(event.args.operator, d.router) &&
        event.args.approved === permission
      )
        matches++;
      if (
        action === "open" &&
        event.eventName === "PositionOpened" &&
        same(event.args.user, account) &&
        event.args.isShort === (side === "Short") &&
        event.args.margin === requested &&
        event.args.debt === openDebt &&
        event.args.collateral >= minCollateral!
      )
        matches++;
      if (
        action === "close" &&
        event.eventName === "PositionClosed" &&
        same(event.args.user, account) &&
        event.args.isShort === (side === "Short") &&
        event.args.stableReturned >= requested!
      ) {
        matches++;
        amount = event.args.stableReturned;
        amountKind = "returned";
      }
    }
    if (matches !== 1) throw new HistoryError("RECEIPT_EVENT_MISMATCH");
  }
  return {
    hash,
    action,
    side,
    symbol: market.symbol,
    amount: amount === null ? null : formatUnits(amount, long.debtDecimals),
    amountKind,
    permission,
    status:
      r.status === "reverted"
        ? "reverted"
        : head - r.blockNumber + 1n < BigInt(confirmations)
          ? "confirming"
          : "confirmed",
    blockNumber: String(r.blockNumber),
    timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
    gasFeeEth: formatUnits(r.gasUsed * r.effectiveGasPrice, 18),
  };
}
export async function readMarginHistory(options: {
  client: PublicClient;
  market: MarketDeployment;
  account: Address;
  explorerUrl: string;
  cursor: HistoryCursor | null;
  confirmations: number;
  timeoutMs: number;
  maxResponseBytes: number;
  fetcher?: typeof fetch;
}): Promise<MarginHistoryPage> {
  const { client, market, account } = options;
  if (
    !isSupportedChainId(market.long.chainId) ||
    market.margin.chainId !== market.long.chainId ||
    (await client.getChainId()) !== market.long.chainId ||
    !Number.isSafeInteger(options.confirmations) ||
    options.confirmations < 1
  )
    throw new HistoryError("INVALID_HISTORY_SCOPE");
  const head = await client.getBlockNumber();
  const contracts = [
    [market.margin.router, market.margin.codeHashes.router],
    [market.long.pair, market.long.codeHashes.pair],
    [market.margin.short.pair, market.margin.short.codeHashes.pair],
    [market.long.debt, market.long.codeHashes.debt],
  ] as const;
  for (const [address, expected] of contracts) {
    const code = await client.getCode({ address, blockNumber: head });
    if (!code || !same(keccak256(code), expected))
      throw new HistoryError("CONTRACT_IDENTITY_MISMATCH");
  }
  const page = await discoverWalletTransactions(options);
  const hashes = [
    ...new Set(
      page.items
        .filter((t) => t.to && contracts.some(([a]) => same(a, t.to!.hash)))
        .map((t) => t.hash),
    ),
  ];
  const rows: MarginHistoryRow[] = [];
  for (const hash of hashes) {
    const row = await verifyMarginHistoryTransaction(
      client,
      market,
      account,
      hash as Hex,
      head,
      options.confirmations,
    );
    if (row) rows.push(row);
  }
  return {
    account,
    chainId: market.long.chainId,
    market: market.symbol,
    rows,
    nextCursor: page.next_page_params,
    checkedAt: new Date().toISOString(),
  };
}
