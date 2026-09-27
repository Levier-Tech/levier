import { chargedGasCost } from "./lib/rh-gas-ledger.mjs";
import { mkdirSync } from "node:fs";
import {
  context,
  artifact,
  assert,
  same,
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

try {
  assert(process.argv.length === 3, "EXPLICIT_TESTNET_PROFILE_REQUIRED");
  const ctx = await context(process.argv[2]);
  const config = parseModulesConfig(ctx.env.RH_MODULES_CONFIG_JSON);
  await verifyModuleInputs(ctx, config);
  const block = await ctx.client.getBlock();
  const gasPrice = await ctx.client.getGasPrice();
  const balance = await ctx.client.getBalance({
    address: ctx.deployer.address,
  });
  const policy = JSON.parse(ctx.env.RH_LIVE_EXECUTION_JSON);
  const modules = [];
  let estimatedCost = 0n;
  for (const spec of moduleSpecs(config, ctx.deployer.address)) {
    if (ctx.state[spec.role]) {
      const codeHash = await verifyModule(
        ctx,
        config,
        spec,
        ctx.state[spec.role],
      );
      modules.push({
        role: spec.role,
        contract: spec.contract,
        status: "deployed-paused",
        address: ctx.state[spec.role],
        codeHash,
      });
      continue;
    }
    const compiled = artifact(spec.contract);
    const data = v.encodeDeployData({ ...compiled, args: spec.args });
    const gas = await ctx.client.estimateGas({
      account: ctx.deployer.address,
      data,
    });
    const fee = gas * gasPrice;
    assert(
      fee <= BigInt(policy.maxTransactionGasCostWei),
      "MODULE_GAS_BUDGET_EXCEEDED",
    );
    estimatedCost += fee;
    modules.push({
      role: spec.role,
      contract: spec.contract,
      status: "prepared-not-deployed",
      creationCodeHash: v.keccak256(data),
      estimatedGas: String(gas),
      estimatedFeeWei: String(fee),
      initialExecution: "paused",
    });
  }
  const reserved = Object.values(ctx.state.operations)
    .filter((op) => same(op.from, ctx.deployer.address))
    .reduce((sum, op) => sum + chargedGasCost(op), 0n);
  const report = {
    version: 1,
    capturedAt: new Date().toISOString(),
    chainId: 46630,
    block: String(block.number),
    base: {
      registry: config.registry,
      lendingRouter: config.lendingRouter,
      status: "reuse-verified-deployment",
    },
    modules,
    oracle: {
      status: ctx.state.oracle
        ? "deployed-reference-oracle"
        : "awaiting-source-and-deployment",
      alternatives: ["VerifiedFeedOracle", "RhTestnetReferenceOracle"],
      referenceApproved: ctx.env.RH_REFERENCE_ORACLE_APPROVED === "true",
      nativeDescriptorPresent: !!ctx.env.RH_ORACLE_CONFIG_JSON,
    },
    markets: [
      {
        symbol: "TSLA/USDG",
        contract: "LevierPair",
        status: ctx.state.acceptanceComplete
          ? "deployed-lifecycle-passed-paused-at-checkpoint"
          : ctx.state.descriptor
            ? "deployed-awaiting-acceptance"
            : "awaiting-verified-oracle",
        direction: "TSLA collateral / USDG debt",
      },
      {
        symbol: "USDG/TSLA",
        contract: "LevierPair",
        status: "future-short-foundation",
        direction: "USDG collateral / TSLA debt",
        needs: [
          "verified oracle",
          "stock liquidity",
          "reverse-pair risk descriptor",
          "swap and closing integration",
        ],
      },
    ],
    excluded: [
      "TestnetERC20 replacement tokens",
      "CompositeSanityOracle fixed/manual prices",
      "unverified AAPL/GOOGL/MSFT pairs",
    ],
    gas: {
      currentPriceWei: String(gasPrice),
      estimatedModuleFeeEth: v.formatEther(estimatedCost),
      deployerBalanceEth: v.formatEther(balance),
      reserveCovered:
        balance > estimatedCost + BigInt(policy.minimumGasReserveWei),
      cumulativeBudgetCovered:
        reserved + estimatedCost <= BigInt(policy.maxSignerGasCostWei),
      note: "Estimate only; each broadcast rechecks current gas, nonce, budget and receipt.",
    },
    transactionsSubmitted: 0,
    applicationEnabled: false,
  };
  assert(
    report.gas.reserveCovered && report.gas.cumulativeBudgetCovered,
    "SUITE_GAS_BUDGET_INSUFFICIENT",
  );
  mkdirSync(".secrets/rh-suite", { recursive: true, mode: 0o700 });
  save(".secrets/rh-suite/plan.json", report);
  // Public readiness summary excludes local credentials and configured addresses.
  mkdirSync("docs/evidence/rh-suite-preparation", { recursive: true });
  save("docs/evidence/rh-suite-preparation/preflight.json", {
    ...report,
    base: { status: report.base.status },
    modules: modules.map(({ address, ...rest }) => rest),
  });
  console.log(
    JSON.stringify({
      chainId: report.chainId,
      modulesPrepared: modules.filter(
        (m) => m.status === "prepared-not-deployed",
      ).length,
      gas: report.gas,
      oracle: report.oracle.status,
      transactionsSubmitted: 0,
    }),
  );
} catch (error) {
  safeFailure(error);
}
