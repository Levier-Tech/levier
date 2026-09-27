import { acquireLock } from "./lib/process-lock.mjs";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { parseEnv } from "node:util";
import environment from "../apps/web/config/environment.cjs";
import {
  context,
  artifact,
  assert,
  same,
  verifyRuntime,
  verifyBinding,
  updateEnv,
  save,
  v,
  safeFailure,
} from "./lib/rh-live.mjs";
import {
  parseModulesConfig,
  moduleSpecs,
  verifyModuleInputs,
  verifyModule,
} from "./lib/rh-modules.mjs";
import {
  readLendingSnapshot,
  verifyPairEvent,
} from "../apps/web/src/lib/lending-client.ts";

try {
  acquireLock(".secrets/rh-live/operations.lock");
  assert(process.argv.length === 3, "EXPLICIT_TESTNET_PROFILE_REQUIRED");
  const ctx = await context(process.argv[2]);
  const { state, client, env } = ctx;
  assert(
    state.acceptanceComplete && state.descriptor,
    "FUNDED_ACCEPTANCE_REQUIRED",
  );
  const binding = JSON.parse(env.RH_REFERENCE_BINDING_JSON);
  const policy = JSON.parse(env.RH_LIVE_EXECUTION_JSON);
  const modules = parseModulesConfig(env.RH_MODULES_CONFIG_JSON);
  await verifyBinding(ctx, binding);
  await verifyModuleInputs(ctx, modules);
  const contracts = [];
  for (const [role, name] of [
    ["registry", "LeveraMarketRegistry"],
    ["router", "LeveraRouter"],
    ...moduleSpecs(modules, ctx.deployer.address).map((s) => [
      s.role,
      s.contract,
    ]),
    ["oracle", "RhTestnetReferenceOracle"],
    ["pair", "LeveraPair"],
  ]) {
    const address = state[role];
    const codeHash = await verifyRuntime(client, address, name);
    assert(
      same(codeHash, state[`${role}CodeHash`]),
      "MANIFEST_RUNTIME_MISMATCH",
    );
    const op = state.operations[`deploy-${role}`];
    assert(
      op?.receipt && same(op.receipt.contractAddress, address),
      "CONTRACT_RECEIPT_MISSING",
    );
    contracts.push({
      role,
      contract: name,
      address,
      codeHash,
      transactionHash: op.hash,
      blockNumber: op.receipt.blockNumber,
    });
  }
  for (const spec of moduleSpecs(modules, ctx.deployer.address))
    await verifyModule(ctx, modules, spec, state[spec.role]);
  const read = (address, contract, functionName, args = []) =>
    client.readContract({
      address,
      abi: artifact(contract).abi,
      functionName,
      args,
    });
  assert(
    same(await read(state.pair, "LeveraPair", "owner"), ctx.deployer.address),
    "PAIR_OWNER_MISMATCH",
  );
  const oracleExpected = {
    publisher: ctx.publisher.address,
    bindingHash: v.keccak256(v.toHex(JSON.stringify(binding))),
    collateral: binding.collateral,
    debt: binding.debt,
    collateralMaxAge: binding.stockMaxAgeSeconds,
    debtMaxAge: binding.debtMaxAgeSeconds,
    collateralMin: binding.stockMin18,
    collateralMax: binding.stockMax18,
    debtMin: binding.debtMin18,
    debtMax: binding.debtMax18,
    maxDeviationBps: binding.maxDeviationBps,
  };
  for (const [name, value] of Object.entries(oracleExpected))
    assert(
      same(await read(state.oracle, "RhTestnetReferenceOracle", name), value),
      "ORACLE_IMMUTABLE_MISMATCH",
    );
  const market = await read(
    state.registry,
    "LeveraMarketRegistry",
    "getMarket",
    [state.marketId],
  );
  assert(
    market.status === 2 &&
      market.maxLtvBps === BigInt(policy.maxLtvBps) &&
      market.liquidationLtvBps === BigInt(policy.liquidationLtvBps) &&
      market.supplyCap === BigInt(policy.supplyCapRaw) &&
      market.borrowCap === BigInt(policy.borrowCapRaw) &&
      market.maxLeverageBps === 10000n,
    "MARKET_RISK_CONFIGURATION_MISMATCH",
  );

  let totalFee = 0n,
    continuationFee = 0n;
  const transactions = [];
  const receipts = new Map();
  const earlier = new Set([
    "deploy-registry",
    "deploy-router",
    "authorize-router",
    "deploy-leverageRouter",
    "deploy-shortRouter",
    "deploy-autoProtect",
    "deploy-leveraVault",
  ]);
  for (const [operation, op] of Object.entries(state.operations)) {
    const receipt = await client.getTransactionReceipt({ hash: op.hash });
    const tx = await client.getTransaction({ hash: op.hash });
    assert(
      receipt.status === "success" &&
        same(tx.from, op.from) &&
        same(tx.to ?? "", op.to ?? "") &&
        v.keccak256(tx.input) === op.dataHash,
      "JOURNAL_TRANSACTION_MISMATCH",
    );
    assert(
      (await client.getBlock({ blockNumber: receipt.blockNumber })).hash ===
        receipt.blockHash,
      "RECEIPT_REORG",
    );
    const fee = receipt.gasUsed * receipt.effectiveGasPrice;
    totalFee += fee;
    if (!earlier.has(operation)) continuationFee += fee;
    transactions.push({
      operation,
      hash: op.hash,
      blockNumber: String(receipt.blockNumber),
      status: receipt.status,
      gasFeeEth: v.formatEther(fee),
      signerRole: same(op.from, ctx.deployer.address)
        ? "deployer"
        : "publisher",
    });
    receipts.set(operation, receipt);
  }
  for (const action of ["deposit", "borrow", "repay", "withdraw"]) {
    const amount = BigInt(
      action === "deposit" || action === "withdraw"
        ? policy.acceptanceCollateralRaw
        : policy.acceptanceDebtRaw,
    );
    const receipt = receipts.get(`acceptance-${action}`);
    assert(receipt, "ACCEPTANCE_RECEIPT_MISSING");
    verifyPairEvent(
      receipt.logs,
      state.descriptor,
      ctx.deployer.address,
      action,
      amount,
    );
  }
  const after = await readLendingSnapshot(
    client,
    state.descriptor,
    ctx.deployer.address,
  );
  const tester = await readLendingSnapshot(
    client,
    state.descriptor,
    env.TESTER_ADDRESS,
  );
  assert(
    after.collateral === 0n &&
      after.debt === 0n &&
      after.status === 2 &&
      after.collateralBalance ===
        BigInt(state.acceptanceBefore.collateralBalance) &&
      after.debtBalance ===
        BigInt(state.acceptanceBefore.debtBalance) -
          BigInt(policy.liquidityRaw) &&
      after.liquidity === BigInt(policy.liquidityRaw),
    "FINAL_LENDING_ACCOUNTING_MISMATCH",
  );
  const allowances = {};
  for (const role of ["collateral", "debt"]) {
    allowances[role] = await client.readContract({
      address: binding[role],
      abi: v.erc20Abi,
      functionName: "allowance",
      args: [ctx.deployer.address, state.pair],
    });
    assert(allowances[role] === 0n, "ACCEPTANCE_ALLOWANCE_REMAINS");
  }
  const borrowReceipt = receipts.get("acceptance-borrow");
  const borrowBlock = await client.getBlock({
    blockNumber: borrowReceipt.blockNumber,
  });
  const pricesAtBorrow = {};
  for (const role of ["collateral", "debt"])
    pricesAtBorrow[role] = await client.readContract({
      address: state.oracle,
      abi: artifact("RhTestnetReferenceOracle").abi,
      functionName: "getPrice",
      args: [binding[role]],
      blockNumber: borrowReceipt.blockNumber,
    });
  const profileUpdates = [];
  for (const path of [".env.testnet", ".env", "apps/web/.env"]) {
    const current = parseEnv(readFileSync(path, "utf8"));
    assert(
      current.NETWORK_MODE === "TESTNET" &&
        current.CHAIN_ID === "46630" &&
        current.TRADING_ENABLED === "false" &&
        current.LENDING_ENABLED === "false" &&
        (statSync(path).mode & 0o077) === 0,
      "ENV_EXPORT_GUARD",
    );
    const addresses = JSON.parse(current.PROTOCOL_ADDRESSES);
    addresses.oracle = state.oracle;
    addresses.registry = state.registry;
    addresses.leveraRouter = state.router;
    // This is the only registered/verified pair. Historical unverified pair entries are not exported.
    addresses.pairs = { [state.descriptor.collateralSymbol]: state.pair };
    const updates = {
      PROTOCOL_ADDRESSES: JSON.stringify(addresses),
      LENDING_DEPLOYMENT_JSON: JSON.stringify(state.descriptor),
    };
    if (path !== "apps/web/.env")
      Object.assign(updates, {
        ORACLE_ADDRESS: state.oracle,
        TSLA_PAIR_ADDRESS: state.pair,
        MARKET_DEPLOYMENT_START_BLOCK: String(
          state.operations["deploy-pair"].receipt.blockNumber,
        ),
      });
    environment.validate(environment.clientSchema, { ...current, ...updates });
    profileUpdates.push({ path, updates });
  }
  for (const { path, updates } of profileUpdates) updateEnv(path, updates);
  const report = {
    capturedAt: new Date().toISOString(),
    chainId: 46630,
    coreDeploymentComplete: true,
    fundedLendingAcceptancePassed: true,
    browserWalletAcceptancePassed: false,
    applicationEnabled: false,
    contracts,
    transactions,
    transactionCount: transactions.length,
    continuationTransactionCount: transactions.filter(
      (t) => !earlier.has(t.operation),
    ).length,
    totalRecordedGasFeeEth: v.formatEther(totalFee),
    continuationGasFeeEth: v.formatEther(continuationFee),
    market,
    finalDeployerPosition: after,
    testerSnapshot: tester,
    finalAllowances: allowances,
    oracle: {
      mode: binding.mode,
      nativeFeedVerified: false,
      stockSource: binding.stockApiUrl,
      debtSource: binding.usdgBookUrl,
      sourceTimestampPolicy:
        "Exchange snapshot timestamp and CRC32; Robinhood quote timestamp; never local retrieval time",
      maxStockAgeSeconds: binding.stockMaxAgeSeconds,
      maxDebtAgeSeconds: binding.debtMaxAgeSeconds,
      pricesAtBorrow,
      borrowBlockTimestamp: String(borrowBlock.timestamp),
      continuousPublisherRunning: false,
    },
    exportedProfiles: profileUpdates.map((p) => p.path),
    mainnetActions: 0,
    databaseMutations: 0,
    limitations: [
      "Market paused after acceptance; production UI execution disabled",
      "Publisher ran for verified reports, not as a continuous service",
      "Long/Short swaps and closing, vault allocation/interest and collateral-funded deleveraging remain incomplete",
    ],
  };
  mkdirSync("docs/evidence/rh-core-deployment", { recursive: true });
  save("docs/evidence/rh-core-deployment/final-verification.json", report);
  save(`${ctx.directory}/complete-manifest.json`, report);
  console.log(
    JSON.stringify({
      coreDeploymentComplete: true,
      contracts: contracts.length,
      fundedLendingAcceptancePassed: true,
      transactionsVerified: transactions.length,
      continuationTransactions: report.continuationTransactionCount,
      continuationGasFeeEth: report.continuationGasFeeEth,
      totalGasFeeEth: report.totalRecordedGasFeeEth,
      marketStatus: "PAUSED",
      envProfilesUpdated: profileUpdates.length,
      finalAllowances: "ZERO",
    }),
  );
} catch (error) {
  safeFailure(error);
}
