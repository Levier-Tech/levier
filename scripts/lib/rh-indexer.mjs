import { createHash } from "node:crypto";
import { v } from "./rh-live.mjs";
import {
  LevierPairABI,
  LevierMarketRegistryABI,
} from "../../apps/web/src/contracts/generated/lending.ts";
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const names = {
  CollateralDeposited: "deposit",
  CollateralWithdrawn: "withdraw",
  DebtBorrowed: "borrow",
  DebtRepaid: "repay",
  PositionLiquidated: "liquidation",
};
export const financialEvents = LevierPairABI.filter(
  (x) => x.type === "event" && x.name in names,
);
export const descriptorHash = (d) =>
  "0x" + createHash("sha256").update(JSON.stringify(d)).digest("hex");
export function replayEvents(events) {
  const accounts = {};
  const seen = new Set();
  for (const e of events) {
    const key = e.transactionHash + ":" + e.logIndex;
    if (seen.has(key)) throw Error("DUPLICATE_EVENT");
    seen.add(key);
    const p = (accounts[e.user] ??= { collateral: 0n, debt: 0n });
    const amount = BigInt(e.amountRaw);
    if (amount < 0n || !Object.values(names).includes(e.action))
      throw Error("INVALID_EVENT");
    if (e.action === "deposit") p.collateral += amount;
    if (e.action === "withdraw") p.collateral -= amount;
    if (e.action === "borrow") p.debt += amount;
    if (e.action === "repay") p.debt -= amount;
    if (e.action === "liquidation") {
      p.debt -= amount;
      const seized = BigInt(e.collateralSeizedRaw);
      if (seized < 0n) throw Error("INVALID_EVENT");
      p.collateral -= seized;
    }
    if (p.collateral < 0n || p.debt < 0n)
      throw Error("NEGATIVE_REPLAY_BALANCE");
  }
  return accounts;
}
export async function verifyIndexerIdentity(client, d, start) {
  if (
    ![46630, 4663].includes(d.chainId) ||
    (await client.getChainId()) !== d.chainId
  )
    throw Error("INDEXER_WRONG_CHAIN");
  const head = await client.getBlockNumber();
  for (const role of ["pair", "registry", "oracle", "collateral", "debt"]) {
    const code = await client.getCode({ address: d[role], blockNumber: head });
    if (!code || !same(v.keccak256(code), d.codeHashes[role]))
      throw Error("INDEXER_CODE_MISMATCH");
  }
  if (start <= 0n || start > head) throw Error("INDEXER_START_INVALID");
  const before = await client.getCode({
    address: d.pair,
    blockNumber: start - 1n,
  });
  const at = await client.getCode({ address: d.pair, blockNumber: start });
  if (
    (before && before !== "0x") ||
    !at ||
    at === "0x" ||
    !same(v.keccak256(at), d.codeHashes.pair)
  )
    throw Error("INDEXER_START_NOT_DEPLOYMENT");
  const m = await client.readContract({
    address: d.registry,
    abi: LevierMarketRegistryABI,
    functionName: "getMarket",
    args: [d.marketId],
    blockNumber: head,
  });
  if (
    !same(m.pairAddress, d.pair) ||
    !same(m.collateralToken, d.collateral) ||
    !same(m.debtToken, d.debt) ||
    !same(m.oracle, d.oracle)
  )
    throw Error("INDEXER_MARKET_MISMATCH");
  return head;
}
export async function verifyLogs(client, d, logs, from, to) {
  const receipts = new Map(),
    blocks = new Map(),
    rows = [];
  const seen = new Set();
  for (const log of logs) {
    if (
      log.removed ||
      !same(log.address, d.pair) ||
      log.blockNumber === null ||
      log.blockNumber < from ||
      log.blockNumber > to ||
      log.logIndex === null ||
      !log.transactionHash
    )
      throw Error("INDEXER_LOG_INVALID");
    const key = log.transactionHash + ":" + log.logIndex;
    if (seen.has(key)) throw Error("DUPLICATE_EVENT");
    seen.add(key);
    let r = receipts.get(log.transactionHash);
    if (!r) {
      r = await client.getTransactionReceipt({ hash: log.transactionHash });
      receipts.set(log.transactionHash, r);
    }
    let b = blocks.get(String(log.blockNumber));
    if (!b) {
      b = await client.getBlock({ blockNumber: log.blockNumber });
      blocks.set(String(log.blockNumber), b);
    }
    const confirmed = r.logs.find((x) => x.logIndex === log.logIndex);
    if (
      r.status !== "success" ||
      !same(r.transactionHash, log.transactionHash) ||
      r.blockNumber !== log.blockNumber ||
      !same(r.blockHash, log.blockHash) ||
      !same(b.hash, log.blockHash) ||
      !confirmed ||
      !same(confirmed.address, d.pair) ||
      confirmed.data !== log.data ||
      JSON.stringify(confirmed.topics) !== JSON.stringify(log.topics)
    )
      throw Error("INDEXER_RECEIPT_MISMATCH");
    const decoded = v.decodeEventLog({
      abi: financialEvents,
      data: log.data,
      topics: log.topics,
      strict: true,
    });
    const liquidation = decoded.eventName === "PositionLiquidated";
    rows.push({
      transactionHash: log.transactionHash.toLowerCase(),
      logIndex: log.logIndex,
      blockNumber: String(log.blockNumber),
      blockHash: log.blockHash.toLowerCase(),
      timestamp: new Date(Number(b.timestamp) * 1000).toISOString(),
      user: decoded.args.user.toLowerCase(),
      actor: r.from.toLowerCase(),
      action: names[decoded.eventName],
      amountRaw: String(decoded.args[liquidation ? "debtRepaid" : "amount"]),
      ...(liquidation
        ? {
            collateralSeizedRaw: String(decoded.args.collateralSeized),
            liquidator: decoded.args.liquidator.toLowerCase(),
          }
        : {}),
    });
  }
  return rows.sort((a, b) =>
    BigInt(a.blockNumber) === BigInt(b.blockNumber)
      ? a.logIndex - b.logIndex
      : BigInt(a.blockNumber) < BigInt(b.blockNumber)
        ? -1
        : 1,
  );
}
export async function recoverCheckpoint(client, store, scope) {
  const current = await store.checkpoint();
  if (!current) return null;
  if (
    current.descriptor_hash !== scope.descriptorHash ||
    BigInt(current.start_block) !== scope.startBlock
  )
    throw Error("INDEXER_DESCRIPTOR_CHANGED");
  const block = await client.getBlock({
    blockNumber: BigInt(current.block_number),
  });
  if (same(block.hash, current.block_hash)) return current;
  for (const batch of await store.batches()) {
    const canonical = await client.getBlock({
      blockNumber: BigInt(batch.to_block),
    });
    if (same(canonical.hash, batch.block_hash)) {
      await store.rollback(batch);
      return await store.checkpoint();
    }
  }
  await store.rollback(null);
  return null;
}
export async function syncIndexer({
  client,
  logClient,
  deployment: d,
  store,
  policy,
  scope,
  signal,
}) {
  const head = await verifyIndexerIdentity(client, d, scope.startBlock);
  if ((await logClient.getChainId()) !== d.chainId)
    throw Error("INDEXER_LOG_CHAIN_MISMATCH");
  let checkpoint = await recoverCheckpoint(client, store, scope);
  const safeHead = head - BigInt(policy.confirmations) + 1n;
  let from = checkpoint
    ? BigInt(checkpoint.block_number) + 1n
    : scope.startBlock;
  const history = (await store.events()).map((x) => x.payload);
  let committed = 0,
    newEvents = 0;
  while (
    from <= safeHead &&
    committed < policy.maxBatches &&
    !signal?.aborted
  ) {
    const to =
      from + BigInt(policy.batchBlocks) - 1n < safeHead
        ? from + BigInt(policy.batchBlocks) - 1n
        : safeHead;
    const boundary = await client.getBlock({ blockNumber: to });
    if (checkpoint) {
      const previous = await client.getBlock({
        blockNumber: BigInt(checkpoint.block_number),
      });
      if (!same(previous.hash, checkpoint.block_hash))
        throw Error("INDEXER_REORG_RETRY");
    }
    const discovered = await logClient.getLogs({
      address: d.pair,
      events: financialEvents,
      fromBlock: from,
      toBlock: to,
      strict: true,
    });
    const events = await verifyLogs(client, d, discovered, from, to);
    const accounts = replayEvents([...history, ...events]);
    let totalCollateral = 0n,
      totalDebt = 0n;
    for (const [user, p] of Object.entries(accounts)) {
      const observed = await client.readContract({
        address: d.pair,
        abi: LevierPairABI,
        functionName: "accounts",
        args: [user],
        blockNumber: to,
      });
      if (p.collateral !== observed[0] || p.debt !== observed[1])
        throw Error("INDEXER_ACCOUNT_RECONCILIATION_FAILED");
      totalCollateral += p.collateral;
      totalDebt += p.debt;
    }
    const [collateral, debt] = await Promise.all(
      ["totalSupplyCollateral", "totalBorrowedDebt"].map((functionName) =>
        client.readContract({
          address: d.pair,
          abi: LevierPairABI,
          functionName,
          blockNumber: to,
        }),
      ),
    );
    if (collateral !== totalCollateral || debt !== totalDebt)
      throw Error("INDEXER_TOTALS_RECONCILIATION_FAILED");
    const final = await client.getBlock({ blockNumber: to });
    const logBoundary = await logClient.getBlock({ blockNumber: to });
    if (
      !same(final.hash, boundary.hash) ||
      !same(logBoundary.hash, boundary.hash)
    )
      throw Error("INDEXER_REORG_RETRY");
    await store.commit({
      previousBlock: checkpoint?.block_number ?? null,
      from: String(from),
      to: String(to),
      blockHash: boundary.hash.toLowerCase(),
      events,
      accounts,
    });
    history.push(...events);
    checkpoint = await store.checkpoint();
    newEvents += events.length;
    committed++;
    from = to + 1n;
  }
  const latestHead = await client.getBlockNumber();
  const latestSafeHead = latestHead - BigInt(policy.confirmations) + 1n;
  const lastIndexed = checkpoint
    ? BigInt(checkpoint.block_number)
    : scope.startBlock - 1n;
  return {
    capturedAt: new Date().toISOString(),
    chainId: d.chainId,
    pair: d.pair,
    headAtStart: String(head),
    targetBlock: String(safeHead),
    head: String(latestHead),
    safeHead: String(latestSafeHead),
    lagBlocks: String(
      latestSafeHead > lastIndexed ? latestSafeHead - lastIndexed : 0n,
    ),
    checkpoint: checkpoint?.block_number ?? null,
    reconciled: checkpoint?.reconciled ?? false,
    committedBatches: committed,
    newEvents,
    totalEvents: history.length,
    accounts: replayEvents(history),
    targetReached: from > safeHead,
    caughtUp: lastIndexed >= latestSafeHead,
  };
}
