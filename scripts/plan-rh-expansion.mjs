import { chargedGasCost } from "./lib/rh-gas-ledger.mjs";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  existsSync,
} from "node:fs";
import { parseEnv } from "node:util";
import { execFileSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  v,
  assert,
  same,
  artifact,
  verifyRuntime,
  verifyBinding,
  fingerprint,
  save,
  updateEnv,
  json,
} from "./lib/rh-live.mjs";
import { readMarketScope } from "./lib/rh-market-scope.mjs";
import {
  parseExpansionPlan,
  seedRequirements,
  assertFreshReport,
} from "./lib/rh-expansion.mjs";
import { acquireLock } from "./lib/process-lock.mjs";
import {
  parseExpansionReviewPolicy,
  acceptanceCollateralRaw,
  minimumSeedLiquidity,
  summarizePreparedTransactions,
} from "./lib/rh-expansion-plan.mjs";
import { parseReferenceTransport } from "../apps/price-oracle/src/services/referenceTransport.ts";
import { parseRobinhoodTransport } from "../apps/price-oracle/src/services/robinhoodTransport.ts";
import { fetchTestnetReport } from "../apps/price-oracle/src/services/testnetReference.ts";

let stage = "configuration";
try {
  const [profile, directory] = process.argv.slice(2);
  assert(
    process.argv.length === 4 &&
      profile === ".env.testnet" &&
      /^docs\/evidence\/[a-z0-9-]+$/.test(directory ?? ""),
    "EXPLICIT_ARGUMENTS_REQUIRED",
  );
  assert(!existsSync(`${directory}/execution-plan.json`), "EVIDENCE_EXISTS");
  acquireLock(".secrets/rh-live/operations.lock");
  execFileSync("git", ["check-ignore", "-q", profile]);
  assert(
    !execFileSync("git", ["ls-files", "--", profile], {
      encoding: "utf8",
    }).trim() && (statSync(profile).mode & 0o077) === 0,
    "PRIVATE_ENV_REQUIRED",
  );
  const original = readFileSync(profile, "utf8"),
    env = parseEnv(original),
    scope = readMarketScope(env),
    plan = parseExpansionPlan(env, scope);
  const execution = JSON.parse(env.RH_LIVE_EXECUTION_JSON),
    margin = JSON.parse(env.RH_MARGIN_PLAN_JSON),
    review = parseExpansionReviewPolicy(
      env.RH_EXPANSION_REVIEW_POLICY_JSON,
      plan.assets.map((x) => x.symbol),
    );
  assert(
    review.version === 1 && review.approvedForBroadcast === false,
    "REVIEW_ONLY_REQUIRED",
  );
  assert(
    Number.isSafeInteger(review.gasEstimateMultiplier) &&
      review.gasEstimateMultiplier >= 100 &&
      review.gasEstimateMultiplier <= 200,
    "INVALID_GAS_BUFFER",
  );
  assert(
    Number.isSafeInteger(review.maxRunSeconds) &&
      review.maxRunSeconds > 0 &&
      review.maxRunSeconds <= 600,
    "INVALID_RUN_LIMIT",
  );
  for (const p of plan.assets)
    assert(
      /^[1-9]\d*$/.test(review.maxSeedStockRaw[p.symbol]),
      "EXPLICIT_SEED_CAP_REQUIRED",
    );
  const timeout = Number(env.RPC_TIMEOUT_MS);
  assert(Number.isSafeInteger(timeout) && timeout > 0, "RPC_POLICY_REQUIRED");
  const client = v.createPublicClient({
    transport: v.http(env.RPC_URL, { timeout, retryCount: 0 }),
    cacheTime: 0,
  });
  assert((await client.getChainId()) === 46630, "RPC_CHAIN_MISMATCH");
  const state = JSON.parse(readFileSync(".secrets/rh-live/state.json", "utf8"));
  assert(
    state.chainId === 46630 && state.descriptor && state.margin?.descriptor,
    "TSLA_BASE_REQUIRED",
  );
  const d = state.descriptor,
    m = state.margin.descriptor,
    owner = env.DEPLOYER_ADDRESS,
    publisher = env.KEEPER_ADDRESS;
  assert(
    same(d.debt, env.USDG_ISSUER_TESTNET_ADDRESS) &&
      same(d.debt, env.USDG_ADDRESS) &&
      same(owner, m.owner),
    "BASE_IDENTITY_MISMATCH",
  );
  stage = "shared-infrastructure";
  const registryCodeHash = await verifyRuntime(
    client,
    d.registry,
    "LeveraMarketRegistry",
  );
  assert(
    same(registryCodeHash, d.codeHashes.registry),
    "REGISTRY_CODE_CHANGED",
  );
  const registryAbi = artifact("LeveraMarketRegistry").abi;
  const regRead = (functionName, args = []) =>
    client.readContract({
      address: d.registry,
      abi: registryAbi,
      functionName,
      args,
    });
  const [registryOwner, longRisk, shortRisk, factoryCode] = await Promise.all([
    regRead("owner"),
    regRead("getMarket", [d.marketId]),
    regRead("getMarket", [m.short.marketId]),
    client.getCode({ address: m.factory }),
  ]);
  assert(
    same(registryOwner, owner) &&
      same(longRisk.pairAddress, d.pair) &&
      same(shortRisk.pairAddress, m.short.pair),
    "REGISTRY_INPUT_MISMATCH",
  );
  const vendor = JSON.parse(
    readFileSync(
      "packages/contracts/vendor/uniswap-v2-core/build/UniswapV2Factory.json",
      "utf8",
    ),
  );
  const poolArtifact = JSON.parse(
    readFileSync(
      "packages/contracts/vendor/uniswap-v2-core/build/UniswapV2Pair.json",
      "utf8",
    ),
  );
  const hex = (x) => (x.startsWith("0x") ? x : `0x${x}`);
  assert(
    factoryCode === hex(vendor.evm.deployedBytecode.object) &&
      same(v.keccak256(factoryCode), m.codeHashes.factory),
    "FACTORY_CODE_CHANGED",
  );
  const configRisk = (x) => ({
    maxLtvBps: String(x.maxLtvBps),
    liquidationLtvBps: String(x.liquidationLtvBps),
    maxLeverageBps: String(x.maxLeverageBps),
    supplyCapRaw: String(x.supplyCap),
    borrowCapRaw: String(x.borrowCap),
  });
  for (const x of [longRisk, shortRisk])
    assert(
      x.maxLtvBps > 0n &&
        x.maxLtvBps < x.liquidationLtvBps &&
        x.liquidationLtvBps <= 10000n &&
        x.supplyCap > 0n &&
        x.borrowCap > 0n,
      "INVALID_RISK",
    );
  const http = {
    timeoutMs: Number(env.ORACLE_HTTP_TIMEOUT_MS),
    maxResponseBytes: Number(env.ORACLE_MAX_RESPONSE_BYTES),
    robinhoodTransport: parseRobinhoodTransport(env.ROBINHOOD_TRANSPORT_JSON),
    usdgTransport: parseReferenceTransport(env.USDG_TRANSPORT_JSON),
  };
  stage = "fresh-references";
  const markets = await Promise.all(
    plan.assets.map(async (p) => {
      const row = scope.find((x) => x.symbol === p.symbol),
        binding = JSON.parse(env[`RH_${p.symbol}_REFERENCE_BINDING_JSON`]);
      assert(
        binding.stockSymbol === p.symbol &&
          same(binding.collateral, row.token) &&
          binding.maxSpreadBps <= 100,
        "MARKET_BINDING_MISMATCH",
      );
      await verifyBinding({ client, env }, binding);
      const reference = await fetchTestnetReport(binding, http);
      const stockBalance = await client.readContract({
        address: row.token,
        abi: v.erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      });
      const seed = seedRequirements(
        { ...p, maxSeedStockRaw: review.maxSeedStockRaw[p.symbol] },
        reference,
        stockBalance,
      );
      assert(
        seed.stockBalanceCovered && seed.seedCapCovered,
        "PROPOSED_SEED_NOT_COVERED",
      );
      const pendingPool = await client.readContract({
        address: m.factory,
        abi: vendor.abi,
        functionName: "getPair",
        args: [row.token, d.debt],
      });
      assert(
        same(pendingPool, v.zeroAddress),
        "EXISTING_POOL_REQUIRES_RECONCILIATION",
      );
      const collateral = acceptanceCollateralRaw(
        execution.acceptanceDebtRaw,
        reference.collateralPrice18,
        reference.debtPrice18,
        longRisk.maxLtvBps,
      );
      assert(
        collateral <= longRisk.supplyCap &&
          BigInt(execution.acceptanceDebtRaw) <= longRisk.borrowCap,
        "ACCEPTANCE_EXCEEDS_CAP",
      );
      assert(
        stockBalance >= BigInt(seed.totalStockRaw) + collateral,
        "ACCEPTANCE_STOCK_BALANCE_REQUIRED",
      );
      const longSlug = `${p.symbol.toLowerCase()}-usdg-testnet`,
        shortSlug = `usdg-${p.symbol.toLowerCase()}-short-testnet`;
      // Conservative initial LP minimum calculated from exact seed units and existing slippage policy.
      const minLiquidity = minimumSeedLiquidity(
        seed.seedStockRaw,
        p.seedStableRaw,
        margin.policy.slippageBps,
      );
      return {
        ...p,
        stock: row.token,
        stockCodeHash: binding.tokenFingerprints.collateral.codeHash,
        uid: binding.testnetStockUid,
        multiplier18: binding.multiplier18,
        longSlug,
        shortSlug,
        binding,
        bindingHash: v.keccak256(v.toHex(JSON.stringify(binding))),
        reference,
        evidenceHash: v.keccak256(v.toHex(json(reference))),
        seedStockRaw: seed.seedStockRaw,
        proposedMaxSeedStockRaw: review.maxSeedStockRaw[p.symbol],
        minLiquidityRaw: String(minLiquidity),
        longRisk: configRisk(longRisk),
        shortRisk: configRisk(shortRisk),
        acceptanceCollateralRaw: String(collateral),
      };
    }),
  );
  stage = "snapshot-and-funding";
  const blockNumber = await client.getBlockNumber(),
    block = await client.getBlock({ blockNumber });
  const stableFingerprint = await fingerprint(client, d.debt, blockNumber);
  const stableBalance = await client.readContract({
    address: d.debt,
    abi: v.erc20Abi,
    functionName: "balanceOf",
    args: [owner],
    blockNumber,
  });
  const required = plan.assets.reduce(
    (n, p) => n + BigInt(p.seedStableRaw) + BigInt(p.longLiquidityRaw),
    0n,
  );
  assert(
    stableBalance >= required + BigInt(margin.acceptanceMarginRaw),
    "FUNDING_AND_ACCEPTANCE_RESERVE_REQUIRED",
  );
  for (const market of markets) {
    assertFreshReport(
      market.binding,
      market.reference,
      Number(block.timestamp),
    );
    assertFreshReport(
      market.binding,
      market.reference,
      Math.floor(Date.now() / 1000),
    );
  }
  const draft = {
    version: 1,
    mode: "PREPARATION_ONLY",
    chainId: 46630,
    owner,
    publisher,
    stable: d.debt,
    registry: d.registry,
    factory: m.factory,
    registryCodeHash,
    factoryCodeHash: v.keccak256(factoryCode),
    poolCodeHash: v.keccak256(hex(poolArtifact.evm.deployedBytecode.object)),
    stableCodeHash: stableFingerprint.codeHash,
    marketCount: markets.length,
    acceptanceDebtRaw: execution.acceptanceDebtRaw,
    acceptanceMarginRaw: margin.acceptanceMarginRaw,
    longLeverageBps: margin.policy.longLeveragesBps[0],
    shortExposureBps: margin.policy.shortExposureBps[0],
    slippageBps: margin.policy.slippageBps,
    deadlineSeconds: margin.policy.deadlineSeconds,
    markets,
  };
  assert(
    draft.longLeverageBps > 10000 &&
      draft.shortExposureBps > 0 &&
      draft.slippageBps > 0 &&
      draft.slippageBps < 10000 &&
      draft.deadlineSeconds > 0,
    "ACCEPTANCE_POLICY_REQUIRED",
  );
  const [ownerNonce, publisherNonce, gasPrice, ownerGas, publisherGas] =
    await Promise.all([
      client.getTransactionCount({ address: owner }),
      client.getTransactionCount({ address: publisher }),
      client.getGasPrice(),
      client.getBalance({ address: owner }),
      client.getBalance({ address: publisher }),
    ]);
  assert(
    (await client.getBlock({ blockNumber })).hash === block.hash,
    "SNAPSHOT_REORG",
  );
  const privateDirectory = `.secrets/rh-expansion/plan-${Date.now()}`;
  mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
  save(`${privateDirectory}/draft.json`, draft);
  const startedAt = Date.now();
  console.log(
    JSON.stringify({
      stage: "fork-validation-started",
      markets: markets.map((x) => x.symbol),
      block: String(blockNumber),
      signers: "addresses-only",
      transactionsSubmitted: 0,
    }),
  );
  stage = "fork-validation";
  // Only an explicit allowlist enters the child process; no private key or provider secret is printed.
  const childEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    RPC_URL: env.RPC_URL,
    RH_EXPANSION_DRAFT_JSON: JSON.stringify(draft),
  };
  const forge = join(homedir(), ".foundry/bin/forge");
  const result = await new Promise((resolve) => {
    const child = spawn(
      forge,
      [
        "script",
        "script/PrepareRhExpansion.s.sol:PrepareRhExpansion",
        "--rpc-url",
        "robinhood_testnet",
        "--fork-block-number",
        String(blockNumber),
        "--gas-estimate-multiplier",
        String(review.gasEstimateMultiplier),
        "--non-interactive",
      ],
      {
        cwd: "packages/contracts",
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "",
      overflow = false;
    const append = (chunk) => {
      output += chunk.toString();
      if (output.length > 8 * 1024 * 1024) {
        overflow = true;
        child.kill("SIGTERM");
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(
      () => child.kill("SIGTERM"),
      review.maxRunSeconds * 1000,
    );
    child.once("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, output: "PROCESS_START_FAILED" });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !overflow, output });
    });
  });
  let log = result.output;
  for (const [key, value] of Object.entries(env))
    if (
      /PRIVATE_KEY|RPC_URL|API_KEY|DATABASE_URL|SUPABASE|SECRET|PASSWORD/.test(
        key,
      ) &&
      value.length > 8
    )
      log = log.replaceAll(value, "[REDACTED]");
  writeFileSync(`${privateDirectory}/validation.log`, log, {
    mode: 0o600,
    flag: "wx",
  });
  assert(result.ok, "FORK_VALIDATION_FAILED");
  stage = "estimate-report";
  const artifactPath =
    "packages/contracts/broadcast/PrepareRhExpansion.s.sol/46630/dry-run/run-latest.json";
  assert(statSync(artifactPath).mtimeMs >= startedAt, "DRY_RUN_ARTIFACT_STALE");
  const generated = JSON.parse(readFileSync(artifactPath, "utf8"));
  const { costs, maxTxCost, operations } = summarizePreparedTransactions(
    generated,
    owner,
    publisher,
    gasPrice,
  );
  const reserved = (address) =>
    Object.values(state.operations)
      .filter((x) => same(x.from, address))
      .reduce((n, x) => n + chargedGasCost(x), 0n);
  const gas = {
    sampleGasPriceWei: String(gasPrice),
    foundryGasMultiplier: review.gasEstimateMultiplier,
    estimatedDeployerFeeEth: v.formatEther(costs.deployer),
    estimatedPublisherFeeEth: v.formatEther(costs.publisher),
    maxTransactionFeeEth: v.formatEther(maxTxCost),
    currentSignerLimitEth: v.formatEther(BigInt(execution.maxSignerGasCostWei)),
    existingDeployerReservedEth: v.formatEther(reserved(owner)),
    minimumCumulativeDeployerLimitEth: v.formatEther(
      reserved(owner) + costs.deployer,
    ),
    existingPublisherReservedEth: v.formatEther(reserved(publisher)),
    minimumCumulativePublisherLimitEth: v.formatEther(
      reserved(publisher) + costs.publisher,
    ),
    deployerWalletEth: v.formatEther(ownerGas),
    publisherWalletEth: v.formatEther(publisherGas),
    walletReservesCovered:
      ownerGas > costs.deployer + BigInt(execution.minimumGasReserveWei) &&
      publisherGas > costs.publisher + BigInt(execution.minimumGasReserveWei),
    existingSignerLimitCoversBatch:
      reserved(owner) + costs.deployer <=
        BigInt(execution.maxSignerGasCostWei) &&
      reserved(publisher) + costs.publisher <=
        BigInt(execution.maxSignerGasCostWei),
    note: "Fork transaction estimates with the explicit Foundry gas buffer at sampled gas price; re-estimate on live RPC before each send, including rollup fee effects. Ongoing publisher operation after this batch is excluded.",
  };
  assert(
    (await client.getTransactionCount({ address: owner })) === ownerNonce &&
      (await client.getTransactionCount({ address: publisher })) ===
        publisherNonce,
    "SIGNER_CHANGED_DURING_REVIEW",
  );
  assert(
    readFileSync(profile, "utf8") === original,
    "ENV_CHANGED_DURING_REVIEW",
  );
  updateEnv(profile, { RH_EXPANSION_DRAFT_JSON: JSON.stringify(draft) });
  const report = {
    capturedAt: new Date().toISOString(),
    chainId: 46630,
    forkBlock: String(blockNumber),
    draftHash: v.keccak256(v.toHex(JSON.stringify(draft))),
    sharedInfrastructureVerified: true,
    simulationPassed: true,
    liveAcceptancePassed: false,
    transactionsSubmitted: 0,
    signerNoncesUnchanged: true,
    markets: markets.map((x) => ({
      symbol: x.symbol,
      longSlug: x.longSlug,
      shortSlug: x.shortSlug,
      longRisk: x.longRisk,
      shortRisk: x.shortRisk,
      seedStock: v.formatUnits(BigInt(x.seedStockRaw), 18),
      currentMaxSeedStock: v.formatUnits(BigInt(x.maxSeedStockRaw), 18),
      proposedMaxSeedStock: v.formatUnits(
        BigInt(x.proposedMaxSeedStockRaw),
        18,
      ),
      acceptanceCollateral: v.formatUnits(
        BigInt(x.acceptanceCollateralRaw),
        18,
      ),
      validatedOnFork: [
        "deployment",
        "registry authorization",
        "real-token liquidity seeding",
        "direct lending lifecycle",
        "long open-close",
        "short open-close",
        "empty positions and router",
        "final paused state",
      ],
    })),
    funding: {
      requiredUsdg: v.formatUnits(required, 6),
      deployerUsdg: v.formatUnits(stableBalance, 6),
    },
    gas,
    operations,
    requiresBeforeBroadcast: [
      "Review proposed seed caps and cumulative gas budget",
      "Implement per-market receipt journal and resumable live executor",
      "Refresh prices and balances immediately before signing",
      "Extend bounded multi-market publisher",
      "Complete real testnet acceptance before enabling browser markets",
    ],
    applicationEnabled: false,
  };
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/execution-plan.json`, json(report) + "\n", {
    flag: "wx",
  });
  console.log(
    json({
      ...report,
      operations: undefined,
      operationCount: operations.length,
    }),
  );
} catch (error) {
  const code = /^[A-Z][A-Z0-9_]{2,90}$/.test(error?.message ?? "")
    ? error.message
    : "DETAILS_REDACTED";
  console.error(
    `EXPANSION_PLAN_FAILED at ${stage}: ${code}; details retained privately when available. No live transaction submitted.`,
  );
  process.exitCode = 1;
}
