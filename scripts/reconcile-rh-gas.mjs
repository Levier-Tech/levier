import { mkdirSync } from "node:fs";
import { context, assert, same, save, v, safeFailure } from "./lib/rh-live.mjs";
import { receiptGasSettlement, chargedGasCost } from "./lib/rh-gas-ledger.mjs";
import { acquireLock } from "./lib/process-lock.mjs";
import { setTimeout as delay } from "node:timers/promises";
let stage = "context";
async function readWithRetry(read) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (attempt === 3) throw error;
      await delay(1000 * 2 ** attempt);
    }
  }
}
try {
  assert(
    process.argv.length === 3 && process.argv[2] === ".env.testnet",
    "EXPLICIT_TESTNET_PROFILE_REQUIRED",
  );
  acquireLock(".secrets/rh-live/operations.lock");
  const ctx = await context(process.argv[2]),
    policy = JSON.parse(ctx.env.RH_LIVE_EXECUTION_JSON),
    head = await ctx.client.getBlock();
  const ops = Object.entries(ctx.state.operations),
    settlements = [];
  for (let i = 0; i < ops.length; i += 2) {
    stage = `receipts-${i}`;
    const group = await Promise.all(
      ops.slice(i, i + 2).map(async ([id, operation]) => {
        // Any unresolved operation keeps its entire reservation. No new transaction is signed.
        if (!operation.receipt) return null;
        const receipt = await readWithRetry(() =>
          ctx.client.getTransactionReceipt({
            hash: operation.hash,
          }),
        );
        const block = await readWithRetry(() =>
          ctx.client.getBlock({
            blockNumber: receipt.blockNumber,
          }),
        );
        return {
          id,
          receipt,
          settlement: receiptGasSettlement(
            operation,
            receipt,
            block.hash,
            head.number,
            policy.confirmations,
          ),
        };
      }),
    );
    settlements.push(...group.filter(Boolean));
    if (settlements.length % 20 === 0)
      console.log(JSON.stringify({ verifiedReceipts: settlements.length }));
    await delay(100);
  }
  assert(
    (await ctx.client.getBlock({ blockNumber: head.number })).hash ===
      head.hash,
    "GAS_RECONCILIATION_REORG",
  );
  for (const { id, receipt, settlement } of settlements) {
    ctx.state.operations[id].receipt = receipt;
    ctx.state.operations[id].gasSettlement = settlement;
  }
  ctx.state.gasLedgerAnchor = {
    blockNumber: String(head.number),
    blockHash: head.hash,
  };
  ctx.persist();
  const accounts = Object.fromEntries(
    [
      ["deployer", ctx.deployer.address],
      ["publisher", ctx.publisher.address],
    ].map(([role, address]) => {
      const rows = Object.values(ctx.state.operations).filter((x) =>
        same(x.from, address),
      );
      return [
        role,
        {
          operations: rows.length,
          originalReservationsEth: v.formatEther(
            rows.reduce((n, x) => n + BigInt(x.reservedGasCostWei), 0n),
          ),
          chargedPlusUnresolvedEth: v.formatEther(
            rows.reduce((n, x) => n + chargedGasCost(x), 0n),
          ),
          unresolved: rows.filter((x) => !x.receipt).length,
        },
      ];
    }),
  );
  const report = {
    capturedAt: new Date().toISOString(),
    chainId: 46630,
    anchorBlock: String(head.number),
    settledOperations: settlements.length,
    accounts,
    unchangedSignerLimitEth: v.formatEther(BigInt(policy.maxSignerGasCostWei)),
    transactionsSubmitted: 0,
    note: "Canonical confirmed receipt fees replace spent reservations; unresolved operations retain full reservation. Original reservations are preserved. Each subsequent send verifies the ledger anchor against reorgs.",
  };
  mkdirSync("docs/evidence/rh-expansion-live", { recursive: true });
  save("docs/evidence/rh-expansion-live/gas-reconciliation.json", report);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(
    JSON.stringify({
      stage,
      errorType: /^[A-Za-z]+Error$/.test(error?.name) ? error.name : "Error",
    }),
  );
  safeFailure(error);
}
