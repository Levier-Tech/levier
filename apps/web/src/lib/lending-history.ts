import { isSupportedChainId } from "./networks";
import { z } from "zod";
import {
  decodeFunctionData,
  decodeEventLog,
  erc20Abi,
  formatUnits,
  keccak256,
  pad,
  toEventSelector,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { LevierPairABI } from "../contracts/generated/lending";
import type { LendingDeployment } from "./lending-client";
import { boundedText } from "./rpc-proxy.mjs";
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const historyCursorSchema = z
  .object({
    block_number: z.number().int().nonnegative(),
    index: z.number().int().nonnegative(),
    items_count: z.number().int().positive().max(100),
    // Blockscout adds these paging keys to next_page_params; each stays strictly validated.
    value: z.string().regex(/^\d{1,78}$/).optional(),
    hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
    inserted_at: z.string().max(40).regex(/^[0-9T:.+\-Z]+$/).optional(),
    fee: z.string().regex(/^\d{1,78}$/).optional(),
    filter: z.enum(["from", "to"]).optional(),
  })
  .strict();
const explorerPage = z.object({
  items: z
    .array(z.object({ hash, to: z.object({ hash: address }).nullable() }))
    .max(50),
  next_page_params: historyCursorSchema.nullable(),
});
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export type HistoryCursor = z.infer<typeof historyCursorSchema>;
export type LendingHistoryRow = {
  hash: Hex;
  action: "deposit" | "borrow" | "repay" | "withdraw" | "approval";
  symbol: string;
  amount: string;
  amountRaw: string;
  requestedAmountRaw: string;
  status: "confirmed" | "confirming" | "reverted";
  blockNumber: string;
  timestamp: string;
  gasFeeEth: string;
  amountKind: "executed" | "requested" | "allowance";
};
export type LendingHistoryPage = {
  account: Address;
  chainId: number;
  rows: LendingHistoryRow[];
  nextCursor: HistoryCursor | null;
  scannedTransactions: number;
  checkedAt: string;
};
export class HistoryError extends Error {}

// The public RPC caps eth_getLogs at 10M blocks for one address and one value per topic,
// and at 100k blocks for wildcard topics, so every query names one contract and one event.
const LOG_RANGE = 10_000_000n;
const MAX_HISTORY_TRANSACTIONS = 50;
export const historyEvents = {
  collateralDeposited: toEventSelector("CollateralDeposited(address,uint256)"),
  collateralWithdrawn: toEventSelector("CollateralWithdrawn(address,uint256)"),
  debtBorrowed: toEventSelector("DebtBorrowed(address,uint256)"),
  debtRepaid: toEventSelector("DebtRepaid(address,uint256)"),
  approval: toEventSelector("Approval(address,address,uint256)"),
  positionOpened: toEventSelector("PositionOpened(address,bool,uint256,uint256,uint256)"),
  positionClosed: toEventSelector("PositionClosed(address,bool,uint256,uint256,uint256)"),
} as const;
export const pairEvents = [
  historyEvents.collateralDeposited,
  historyEvents.collateralWithdrawn,
  historyEvents.debtBorrowed,
  historyEvents.debtRepaid,
];

type RpcLog = { transactionHash: Hex; blockNumber: Hex; logIndex: Hex };
const getLogs = (client: PublicClient, filter: Record<string, unknown>) =>
  client.request({ method: "eth_getLogs", params: [filter] } as never) as Promise<RpcLog[]>;

// Block of the anchor contract's first event (its proxy deployment), found once per server
// process. Logs are used because the public RPC does not serve historical state.
const deployBlocks = new Map<string, bigint>();
async function firstEventBlock(client: PublicClient, address: Address, head: bigint) {
  const key = address.toLowerCase();
  const known = deployBlocks.get(key);
  if (known !== undefined) return known;
  for (let start = 0n; start <= head; start += LOG_RANGE) {
    const end = start + LOG_RANGE - 1n < head ? start + LOG_RANGE - 1n : head;
    const logs = await getLogs(client, { address, fromBlock: toHex(start), toBlock: toHex(end) });
    if (logs.length) {
      const first = logs.reduce(
        (m, l) => (BigInt(l.blockNumber) < m ? BigInt(l.blockNumber) : m),
        BigInt(logs[0].blockNumber),
      );
      deployBlocks.set(key, first);
      return first;
    }
  }
  throw new HistoryError("CONTRACT_DEPLOYMENT_NOT_FOUND");
}

// Finds the account's transactions from events whose first indexed argument is the account.
// Reads the chain directly; the explorer API blocks server-side requests.
export async function discoverAccountTransactions(
  client: PublicClient,
  options: {
    account: Address;
    sources: readonly { address: Address; events: readonly Hex[] }[];
    anchor: Address;
    head: bigint;
  },
): Promise<Hex[]> {
  const from = await firstEventBlock(client, options.anchor, options.head);
  const topic = pad(options.account.toLowerCase() as Hex);
  const found: { hash: Hex; block: bigint; index: number }[] = [];
  for (let start = from; start <= options.head; start += LOG_RANGE) {
    const end = start + LOG_RANGE - 1n < options.head ? start + LOG_RANGE - 1n : options.head;
    // One small query per contract event; together they stay well under the RPC's limits.
    const batches = await Promise.all(
      options.sources.flatMap((source) =>
        source.events.map((event) =>
          getLogs(client, {
            address: source.address,
            fromBlock: toHex(start),
            toBlock: toHex(end),
            topics: [event, topic],
          }),
        ),
      ),
    );
    for (const log of batches.flat())
      found.push({ hash: log.transactionHash, block: BigInt(log.blockNumber), index: Number(log.logIndex) });
  }
  found.sort((a, b) => (a.block === b.block ? b.index - a.index : a.block > b.block ? -1 : 1));
  return [...new Set(found.map((x) => x.hash))].slice(0, MAX_HISTORY_TRANSACTIONS);
}

const actions = {
  depositCollateral: "deposit",
  borrow: "borrow",
  repay: "repay",
  withdrawCollateral: "withdraw",
} as const;
const eventNames = {
  deposit: "CollateralDeposited",
  borrow: "DebtBorrowed",
  repay: "DebtRepaid",
  withdraw: "CollateralWithdrawn",
} as const;
export async function verifyHistoryTransaction(
  client: PublicClient,
  d: LendingDeployment,
  account: Address,
  txHash: Hex,
  head: bigint,
  confirmations: number,
): Promise<LendingHistoryRow | null> {
  const tx = await client.getTransaction({ hash: txHash });
  if (!tx.to || !same(tx.from, account) || tx.value !== 0n) return null;
  let action: LendingHistoryRow["action"],
    symbol: string,
    decimals: number,
    requested: bigint;
  if (same(tx.to, d.pair)) {
    let call;
    try {
      call = decodeFunctionData({ abi: LevierPairABI, data: tx.input });
    } catch {
      return null;
    }
    if (!(call.functionName in actions)) return null;
    action = actions[call.functionName as keyof typeof actions];
    requested = (call.args as readonly [bigint])[0];
    const isStock = action === "deposit" || action === "withdraw";
    symbol = isStock ? d.collateralSymbol : d.debtSymbol;
    decimals = isStock ? d.collateralDecimals : d.debtDecimals;
  } else if (same(tx.to, d.collateral) || same(tx.to, d.debt)) {
    let call;
    try {
      call = decodeFunctionData({ abi: erc20Abi, data: tx.input });
    } catch {
      return null;
    }
    if (call.functionName !== "approve" || !same(call.args[0], d.pair))
      return null;
    action = "approval";
    requested = call.args[1];
    const isStock = same(tx.to, d.collateral);
    symbol = isStock ? d.collateralSymbol : d.debtSymbol;
    decimals = isStock ? d.collateralDecimals : d.debtDecimals;
  } else return null;
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (
    !same(tx.hash, txHash) ||
    tx.blockNumber !== receipt.blockNumber ||
    !same(receipt.transactionHash, txHash) ||
    !same(receipt.from, account) ||
    !receipt.to ||
    !same(receipt.to, tx.to) ||
    receipt.blockNumber > head
  )
    throw new HistoryError("RECEIPT_IDENTITY_MISMATCH");
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (block.hash !== receipt.blockHash || tx.blockHash !== receipt.blockHash)
    throw new HistoryError("RECEIPT_REORGED");
  let amount = requested;
  if (receipt.status === "success") {
    const matching: bigint[] = [];
    for (const log of receipt.logs) {
      if (!same(log.address, action === "approval" ? tx.to : d.pair)) continue;
      try {
        if (action === "approval") {
          const event = decodeEventLog({
            abi: erc20Abi,
            data: log.data,
            topics: log.topics,
          });
          if (
            event.eventName === "Approval" &&
            same(event.args.owner, account) &&
            same(event.args.spender, d.pair)
          )
            matching.push(event.args.value);
        } else {
          const event = decodeEventLog({
            abi: LevierPairABI,
            data: log.data,
            topics: log.topics,
          });
          if (
            event.eventName === eventNames[action] &&
            "user" in event.args &&
            "amount" in event.args &&
            same(event.args.user, account)
          )
            matching.push(event.args.amount);
        }
      } catch {
        /* Other event signatures are not evidence for this action. */
      }
    }
    if (
      matching.length !== 1 ||
      (action === "repay" ? matching[0] > requested : matching[0] !== requested)
    )
      throw new HistoryError("RECEIPT_EVENT_MISMATCH");
    amount = matching[0];
  }
  return {
    hash: txHash,
    action,
    symbol,
    amount: formatUnits(amount, decimals),
    amountRaw: String(amount),
    requestedAmountRaw: String(requested),
    status:
      receipt.status === "reverted"
        ? "reverted"
        : head - receipt.blockNumber + 1n < BigInt(confirmations)
          ? "confirming"
          : "confirmed",
    blockNumber: String(receipt.blockNumber),
    timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
    gasFeeEth: formatUnits(receipt.gasUsed * receipt.effectiveGasPrice, 18),
    amountKind:
      receipt.status === "reverted"
        ? "requested"
        : action === "approval"
          ? "allowance"
          : "executed",
  };
}
export async function readLendingHistory(options: {
  client: PublicClient;
  deployment: LendingDeployment;
  account: Address;
  explorerUrl: string;
  cursor: HistoryCursor | null;
  confirmations: number;
  timeoutMs: number;
  maxResponseBytes: number;
  fetcher?: typeof fetch;
}): Promise<LendingHistoryPage> {
  const { client, deployment: d, account } = options;
  if (
    !isSupportedChainId(d.chainId) ||
    (await client.getChainId()) !== d.chainId
  )
    throw new HistoryError("WRONG_NETWORK");
  const head = await client.getBlockNumber();
  for (const role of ["pair", "collateral", "debt"] as const) {
    const code = await client.getCode({ address: d[role], blockNumber: head });
    if (!code || keccak256(code) !== d.codeHashes[role])
      throw new HistoryError("CONTRACT_IDENTITY_MISMATCH");
  }
  const candidates = await discoverAccountTransactions(client, {
    account,
    sources: [
      { address: d.pair, events: pairEvents },
      { address: d.collateral, events: [historyEvents.approval] },
      { address: d.debt, events: [historyEvents.approval] },
    ],
    anchor: d.pair,
    head,
  });
  const rows: LendingHistoryRow[] = [];
  // Bounded sequential verification avoids an unbounded fan-out against the private RPC.
  for (const txHash of candidates) {
    const row = await verifyHistoryTransaction(
      client,
      d,
      account,
      txHash as Hex,
      head,
      options.confirmations,
    );
    if (row) rows.push(row);
  }
  rows.sort((a, b) =>
    BigInt(a.blockNumber) > BigInt(b.blockNumber)
      ? -1
      : BigInt(a.blockNumber) < BigInt(b.blockNumber)
        ? 1
        : 0,
  );
  return {
    account,
    chainId: d.chainId,
    rows,
    nextCursor: null,
    scannedTransactions: candidates.length,
    checkedAt: new Date().toISOString(),
  };
}

export async function discoverWalletTransactions(options: {
  account: Address;
  explorerUrl: string;
  cursor: HistoryCursor | null;
  timeoutMs: number;
  maxResponseBytes: number;
  fetcher?: typeof fetch;
}) {
  const { account } = options;
  const base = new URL(options.explorerUrl);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  )
    throw new HistoryError("INVALID_EXPLORER_ORIGIN");
  const url = new URL(`/api/v2/addresses/${account}/transactions`, base);
  url.searchParams.set("filter", "from");
  if (options.cursor)
    for (const [key, value] of Object.entries(
      historyCursorSchema.parse(options.cursor),
    ))
      url.searchParams.set(key, String(value));
  const response = await (options.fetcher ?? fetch)(url, {
    signal: AbortSignal.timeout(options.timeoutMs),
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw new HistoryError("HISTORY_DISCOVERY_UNAVAILABLE");
  const page = explorerPage.parse(
    JSON.parse(await boundedText(response.body, options.maxResponseBytes)),
  );
  return page;
}
