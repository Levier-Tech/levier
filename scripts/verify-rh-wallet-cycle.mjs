import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { v, json, assert, safeFailure } from "./lib/rh-live.mjs";
import { LevierPairABI } from "../apps/web/src/contracts/generated/lending.ts";
try {
  const env = parseEnv(readFileSync(".env.testnet", "utf8"));
  const d = JSON.parse(env.LENDING_DEPLOYMENT_JSON);
  assert(env.NETWORK_MODE === "TESTNET" && d.chainId === 46630, "TESTNET_ONLY");
  const c = v.createPublicClient({
    transport: v.http(env.RPC_URL, {
      timeout: Number(env.RPC_TIMEOUT_MS),
      retryCount: 0,
    }),
    cacheTime: 0,
  });
  assert((await c.getChainId()) === d.chainId, "CHAIN_MISMATCH");
  const history = JSON.parse(
    readFileSync("docs/evidence/rh-wallet-acceptance/history.json", "utf8"),
  );
  assert(
    history.account.toLowerCase() === env.TESTER_ADDRESS.toLowerCase(),
    "ACCOUNT_MISMATCH",
  );
  const rows = history.rows
    .filter((r) => r.action !== "approval")
    .sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)));
  assert(
    rows.map((r) => r.action).join(",") === "deposit,borrow,repay,withdraw",
    "CYCLE_SEQUENCE_MISMATCH",
  );
  for (const row of rows) {
    const receipt = await c.getTransactionReceipt({ hash: row.hash });
    assert(
      receipt.status === "success" &&
        receipt.from.toLowerCase() === env.TESTER_ADDRESS.toLowerCase() &&
        receipt.to.toLowerCase() === d.pair.toLowerCase(),
      "RECEIPT_MISMATCH",
    );
  }
  const beforeBlock = BigInt(rows[0].blockNumber) - 1n,
    afterBlock = BigInt(rows.at(-1).blockNumber);
  const read = (blockNumber) =>
    c.readContract({
      address: d.pair,
      abi: LevierPairABI,
      functionName: "accounts",
      args: [env.TESTER_ADDRESS],
      blockNumber,
    });
  const [before, after] = await Promise.all([
    read(beforeBlock),
    read(afterBlock),
  ]);
  assert(
    before[0] === 0n && before[1] === 0n && after[0] === 0n && after[1] === 0n,
    "POSITION_NOT_CLOSED",
  );
  const report = {
    capturedAt: new Date().toISOString(),
    chainId: d.chainId,
    account: env.TESTER_ADDRESS,
    pair: d.pair,
    userReportedBrowserExecution: true,
    agentObservedWalletSigning: false,
    beforeBlock,
    before: { collateral: before[0], debt: before[1] },
    afterBlock,
    after: { collateral: after[0], debt: after[1] },
    actions: rows.map(({ action, hash, amount, symbol }) => ({
      action,
      hash,
      amount,
      symbol,
    })),
    receiptReconciliation: "PASS",
    positionClosed: true,
  };
  writeFileSync(
    "docs/evidence/rh-wallet-acceptance/cycle.json",
    json(report) + "\n",
  );
  console.log(json(report));
} catch (error) {
  safeFailure(error);
  process.exitCode = 1;
}
