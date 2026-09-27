import { readFileSync, mkdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseEnv } from "node:util";
import {
  context,
  artifact,
  v,
  assert,
  same,
  json,
  save,
  submit,
  verifyRuntime,
  verifyBinding,
  updateEnv,
  safeFailure,
} from "./lib/rh-live.mjs";
import { acquireLock } from "./lib/process-lock.mjs";
import {
  seedRequirements,
  referenceOracleArgs,
  assertFreshReport,
} from "./lib/rh-expansion.mjs";
import {
  expansionScopeHash,
  minimumSeedLiquidity,
} from "./lib/rh-expansion-plan.mjs";
import { parseReferenceTransport } from "../apps/price-oracle/src/services/referenceTransport.ts";
import { parseRobinhoodTransport } from "../apps/price-oracle/src/services/robinhoodTransport.ts";
import { fetchTestnetReport } from "../apps/price-oracle/src/services/testnetReference.ts";
import marketConfiguration from "../apps/web/config/market-deployments.cjs";

// One explicit symbol per invocation. All operations share the existing gas/receipt journal.
// This command always leaves the new market paused and its browser entry disabled.
let release;
try {
  const [profile, symbol] = process.argv.slice(2);
  assert(
    process.argv.length === 4 &&
      profile === ".env.testnet" &&
      ["AMZN", "PLTR", "NFLX", "AMD"].includes(symbol),
    "EXPLICIT_EXPANSION_MARKET_REQUIRED",
  );
  const before = parseEnv(readFileSync(profile, "utf8"));
  const draft = JSON.parse(before.RH_EXPANSION_DRAFT_JSON);
  const scopeHash = expansionScopeHash(draft);
  assert(
    before.RH_EXPANSION_APPROVED_SCOPE_HASH === scopeHash,
    "EXPANSION_SCOPE_APPROVAL_REQUIRED",
  );
  const reviewed = draft.markets.find((x) => x.symbol === symbol);
  assert(
    reviewed &&
      before.RH_REFERENCE_ORACLE_APPROVED === "true" &&
      before.RH_TESTNET_DEPLOYMENT_APPROVED === "true",
    "EXPLICIT_DEPLOYMENT_APPROVAL_REQUIRED",
  );
  release = acquireLock(".secrets/rh-live/operations.lock");
  const ctx = await context(profile),
    { client, state, env, deployer, publisher } = ctx;
  for (const path of [".env.testnet", ".env", "apps/web/.env"]) {
    execFileSync("git", ["check-ignore", "-q", path]);
    assert(
      !execFileSync("git", ["ls-files", "--", path], {
        encoding: "utf8",
      }).trim() && (statSync(path).mode & 0o077) === 0,
      "PRIVATE_PROFILE_REQUIRED",
    );
  }
  assert(
    same(deployer.address, draft.owner) &&
      same(publisher.address, draft.publisher),
    "SIGNER_SCOPE_MISMATCH",
  );
  const binding = JSON.parse(env[`RH_${symbol}_REFERENCE_BINDING_JSON`]);
  assert(
    binding.stockSymbol === symbol &&
      v.keccak256(v.toHex(JSON.stringify(binding))) === reviewed.bindingHash,
    "BINDING_SCOPE_MISMATCH",
  );
  await verifyBinding(ctx, binding);
  assert(
    same(
      await verifyRuntime(client, draft.registry, "LeveraMarketRegistry"),
      draft.registryCodeHash,
    ),
    "REGISTRY_CHANGED",
  );
  const registry = artifact("LeveraMarketRegistry").abi,
    pair = artifact("LeveraPair").abi,
    router = artifact("MarginRouter").abi,
    oracle = artifact("RhTestnetReferenceOracle").abi;
  const read = (address, abi, functionName, args = []) =>
    client.readContract({ address, abi, functionName, args });
  assert(
    same(await read(draft.registry, registry, "owner"), deployer.address),
    "REGISTRY_OWNER_CHANGED",
  );
  const factory = JSON.parse(
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
  const factoryCode = await client.getCode({ address: draft.factory });
  assert(
    factoryCode === hex(factory.evm.deployedBytecode.object) &&
      same(v.keccak256(factoryCode), draft.factoryCodeHash),
    "FACTORY_CHANGED",
  );
  const plans = JSON.parse(env.RH_MARKET_EXPANSION_PLAN_JSON);
  assert(
    plans.version === 1 && plans.chainId === 46630,
    "EXPANSION_PLAN_REQUIRED",
  );
  const plan = plans.assets.find((x) => x.symbol === symbol);
  assert(
    plan &&
      ["seedStableRaw", "longLiquidityRaw", "shortLiquidityRaw"].every(
        (k) => plan[k] === reviewed[k],
      ) &&
      plan.maxSeedStockRaw === reviewed.proposedMaxSeedStockRaw,
    "LIVE_LIMITS_DIFFER_FROM_REVIEW",
  );
  state.expansion ??= {};
  const existing = state.expansion[symbol];
  assert(
    !existing || existing.scopeHash === scopeHash,
    "EXPANSION_JOURNAL_SCOPE_CHANGED",
  );
  const entry = (state.expansion[symbol] ??= {
    scopeHash,
    bindingHash: reviewed.bindingHash,
    contracts: {},
  });
  const prefix = `expand-v1-${symbol.toLowerCase()}`;
  const id = (stage) => `${prefix}-${stage}`;
  const call = (stage, to, abi, functionName, args, account = deployer) =>
    submit(ctx, id(stage), account, {
      to,
      data: v.encodeFunctionData({ abi, functionName, args }),
    });
  const getCodeHash = async (address) => {
    const code = await client.getCode({ address });
    assert(code && code !== "0x", "CONTRACT_MISSING");
    return v.keccak256(code);
  };
  const verifyPair = async (
    address,
    marketId,
    collateral,
    debt,
    priceOracle,
  ) => {
    for (const [name, expected] of [
      ["marketId", marketId],
      ["collateralToken", collateral],
      ["debtToken", debt],
      ["oracle", priceOracle],
      ["registry", draft.registry],
      ["owner", deployer.address],
    ])
      assert(
        same(await read(address, pair, name), expected),
        "PAIR_IDENTITY_MISMATCH",
      );
  };
  const http = {
    timeoutMs: Number(env.ORACLE_HTTP_TIMEOUT_MS),
    maxResponseBytes: Number(env.ORACLE_MAX_RESPONSE_BYTES),
    robinhoodTransport: parseRobinhoodTransport(env.ROBINHOOD_TRANSPORT_JSON),
    usdgTransport: parseReferenceTransport(env.USDG_TRANSPORT_JSON),
  };
  const fresh = async () => {
    await verifyBinding(ctx, binding);
    const source = await fetchTestnetReport(binding, http);
    assertFreshReport(binding, source, Math.floor(Date.now() / 1000));
    return source;
  };
  await fresh();
  // Require funding before creating any new contract. Completed transfers are journalled once.
  const remainingStable =
    (state.operations[id("seed-pool")]?.receipt?.status === "success"
      ? 0n
      : BigInt(plan.seedStableRaw)) +
    (state.operations[id("fund-long")]?.receipt?.status === "success"
      ? 0n
      : BigInt(plan.longLiquidityRaw));
  assert(
    (await read(binding.debt, v.erc20Abi, "balanceOf", [deployer.address])) >=
      remainingStable,
    "USDG_FUNDING_REQUIRED",
  );
  ctx.persist();
  async function deploy(role, name, args) {
    const receipt = await submit(ctx, id(`deploy-${role}`), deployer, {
      data: v.encodeDeployData({ ...artifact(name), args }),
    });
    assert(receipt.contractAddress, "DEPLOYED_ADDRESS_MISSING");
    assert(
      !entry.contracts[role] ||
        same(entry.contracts[role], receipt.contractAddress),
      "JOURNAL_ADDRESS_CHANGED",
    );
    entry.contracts[role] = receipt.contractAddress;
    ctx.persist();
    await verifyRuntime(client, receipt.contractAddress, name);
    return receipt.contractAddress;
  }
  const reference = await deploy(
    "referenceOracle",
    "RhTestnetReferenceOracle",
    referenceOracleArgs(binding, publisher.address),
  );
  for (const [name, expected] of [
    ["publisher", publisher.address],
    ["bindingHash", reviewed.bindingHash],
    ["collateral", binding.collateral],
    ["debt", binding.debt],
  ])
    assert(
      same(await read(reference, oracle, name), expected),
      "ORACLE_IDENTITY_MISMATCH",
    );
  const longId = v.keccak256(
    v.encodePacked(
      ["string", "address", "address"],
      [reviewed.longSlug, binding.collateral, binding.debt],
    ),
  );
  const shortId = v.keccak256(
    v.encodePacked(
      ["string", "address", "address"],
      [reviewed.shortSlug, binding.debt, binding.collateral],
    ),
  );
  const longPair = await deploy("longPair", "LeveraPair", [
    longId,
    binding.collateral,
    binding.debt,
    reference,
    draft.registry,
    deployer.address,
  ]);
  const reverse = await deploy("shortOracle", "RhShortReferenceOracle", [
    reference,
    reviewed.bindingHash,
    binding.collateral,
    binding.debt,
    BigInt(binding.maxSpreadBps),
  ]);
  const shortPair = await deploy("shortPair", "LeveraPair", [
    shortId,
    binding.debt,
    binding.collateral,
    reverse,
    draft.registry,
    deployer.address,
  ]);
  await verifyPair(
    longPair,
    longId,
    binding.collateral,
    binding.debt,
    reference,
  );
  await verifyPair(
    shortPair,
    shortId,
    binding.debt,
    binding.collateral,
    reverse,
  );
  for (const [
    side,
    slug,
    address,
    marketId,
    collateral,
    debt,
    priceOracle,
    risk,
  ] of [
    [
      "long",
      reviewed.longSlug,
      longPair,
      longId,
      binding.collateral,
      binding.debt,
      reference,
      reviewed.longRisk,
    ],
    [
      "short",
      reviewed.shortSlug,
      shortPair,
      shortId,
      binding.debt,
      binding.collateral,
      reverse,
      reviewed.shortRisk,
    ],
  ]) {
    await call(`register-${side}`, draft.registry, registry, "addMarket", [
      slug,
      collateral,
      debt,
      address,
      priceOracle,
      3,
      0n,
      BigInt(risk.liquidationLtvBps),
      BigInt(risk.maxLeverageBps),
      BigInt(risk.supplyCapRaw),
      BigInt(risk.borrowCapRaw),
    ]);
    await call(`pause-${side}`, draft.registry, registry, "setMarketStatus", [
      marketId,
      2,
    ]);
    await call(`risk-${side}`, draft.registry, registry, "updateRiskTier", [
      marketId,
      3,
      BigInt(risk.maxLtvBps),
      BigInt(risk.liquidationLtvBps),
      BigInt(risk.maxLeverageBps),
    ]);
    const actual = await read(draft.registry, registry, "getMarket", [
      marketId,
    ]);
    assert(
      actual.status === 2 &&
        same(actual.pairAddress, address) &&
        actual.maxLtvBps === BigInt(risk.maxLtvBps) &&
        actual.liquidationLtvBps === BigInt(risk.liquidationLtvBps) &&
        actual.maxLeverageBps === BigInt(risk.maxLeverageBps) &&
        actual.supplyCap === BigInt(risk.supplyCapRaw) &&
        actual.borrowCap === BigInt(risk.borrowCapRaw),
      "REGISTRY_CONFIGURATION_MISMATCH",
    );
  }
  let pool = await read(draft.factory, factory.abi, "getPair", [
    binding.collateral,
    binding.debt,
  ]);
  if (same(pool, v.zeroAddress) || state.operations[id("create-pool")]) {
    await call("create-pool", draft.factory, factory.abi, "createPair", [
      binding.collateral,
      binding.debt,
    ]);
    pool = await read(draft.factory, factory.abi, "getPair", [
      binding.collateral,
      binding.debt,
    ]);
  }
  assert(
    (await client.getCode({ address: pool })) ===
      hex(poolArtifact.evm.deployedBytecode.object),
    "POOL_CODE_MISMATCH",
  );
  assert(
    same(await getCodeHash(pool), draft.poolCodeHash),
    "POOL_HASH_MISMATCH",
  );
  entry.contracts.pool = pool;
  ctx.persist();
  const marginRouter = await deploy("marginRouter", "MarginRouter", [
    binding.collateral,
    binding.debt,
    longPair,
    shortPair,
    pool,
    deployer.address,
  ]);
  for (const [name, expected] of [
    ["stock", binding.collateral],
    ["stable", binding.debt],
    ["longPair", longPair],
    ["shortPair", shortPair],
    ["pool", pool],
    ["owner", deployer.address],
  ])
    assert(
      same(await read(marginRouter, router, name), expected),
      "MARGIN_ROUTER_IDENTITY_MISMATCH",
    );
  assert(
    await read(marginRouter, router, "isPaused"),
    "NEW_MARKET_MUST_STAY_PAUSED",
  );
  if (!state.operations[id("seed-pool")]) {
    if (!entry.seed) {
      const source = await fresh(),
        stockBalance = await read(binding.collateral, v.erc20Abi, "balanceOf", [
          deployer.address,
        ]);
      const need = seedRequirements(plan, source, stockBalance);
      assert(
        need.stockBalanceCovered && need.seedCapCovered,
        "SEED_LIMIT_EXCEEDED",
      );
      entry.seed = {
        stockRaw: need.seedStockRaw,
        stableRaw: plan.seedStableRaw,
        minLiquidity: String(
          minimumSeedLiquidity(
            need.seedStockRaw,
            plan.seedStableRaw,
            draft.slippageBps,
          ),
        ),
        deadline: String(
          (await client.getBlock()).timestamp + BigInt(draft.deadlineSeconds),
        ),
        source,
      };
      ctx.persist();
    }
    assert(
      BigInt(entry.seed.deadline) > (await client.getBlock()).timestamp,
      "SEED_EXPIRED_RECONCILE_REQUIRED",
    );
    assertFreshReport(
      binding,
      entry.seed.source,
      Math.floor(Date.now() / 1000),
    );
  }
  assert(entry.seed, "SEED_JOURNAL_REQUIRED");
  await call("approve-seed-stock", binding.collateral, v.erc20Abi, "approve", [
    marginRouter,
    BigInt(entry.seed.stockRaw),
  ]);
  await call("approve-seed-stable", binding.debt, v.erc20Abi, "approve", [
    marginRouter,
    BigInt(entry.seed.stableRaw),
  ]);
  if (!state.operations[id("seed-pool")])
    assertFreshReport(
      binding,
      entry.seed.source,
      Math.floor(Date.now() / 1000),
    );
  await call("seed-pool", marginRouter, router, "seedLiquidity", [
    BigInt(entry.seed.stockRaw),
    BigInt(entry.seed.stableRaw),
    BigInt(entry.seed.minLiquidity),
    BigInt(entry.seed.deadline),
  ]);
  await call("fund-long", binding.debt, v.erc20Abi, "transfer", [
    longPair,
    BigInt(plan.longLiquidityRaw),
  ]);
  await call("fund-short", binding.collateral, v.erc20Abi, "transfer", [
    shortPair,
    BigInt(plan.shortLiquidityRaw),
  ]);
  await call(
    "authorize-router",
    draft.registry,
    registry,
    "setAuthorizedRouter",
    [marginRouter, true],
  );
  if (!state.operations[id("initial-publication")]) {
    entry.firstPublication = await fresh();
    ctx.persist();
  }
  const publication = entry.firstPublication;
  assert(publication, "PUBLICATION_JOURNAL_REQUIRED");
  await call(
    "initial-publication",
    reference,
    oracle,
    "publish",
    [
      BigInt(publication.collateralPrice18),
      BigInt(publication.collateralTimestamp),
      BigInt(publication.debtPrice18),
      BigInt(publication.debtTimestamp),
      v.keccak256(v.toHex(json(publication))),
    ],
    publisher,
  );
  const reserves = await read(marginRouter, router, "reserves");
  assert(reserves[0] > 0n && reserves[1] > 0n, "POOL_NOT_FUNDED");
  assert(
    (await read(binding.debt, v.erc20Abi, "balanceOf", [longPair])) >=
      BigInt(plan.longLiquidityRaw) &&
      (await read(binding.collateral, v.erc20Abi, "balanceOf", [shortPair])) >=
        BigInt(plan.shortLiquidityRaw),
    "LENDING_NOT_FUNDED",
  );
  assert(
    (await read(draft.registry, registry, "isAuthorizedRouter", [
      marginRouter,
    ])) && (await read(marginRouter, router, "isPaused")),
    "FINAL_PAUSED_CONFIGURATION_REQUIRED",
  );
  const long = {
    chainId: 46630,
    marketId: longId,
    pair: longPair,
    registry: draft.registry,
    oracle: reference,
    collateral: binding.collateral,
    debt: binding.debt,
    collateralSymbol: symbol,
    debtSymbol: "USDG",
    collateralDecimals: 18,
    debtDecimals: 6,
    codeHashes: {
      pair: await getCodeHash(longPair),
      registry: draft.registryCodeHash,
      oracle: await getCodeHash(reference),
      collateral: binding.tokenFingerprints.collateral.codeHash,
      debt: binding.tokenFingerprints.debt.codeHash,
    },
  };
  const short = {
    chainId: 46630,
    marketId: shortId,
    pair: shortPair,
    registry: draft.registry,
    oracle: reverse,
    collateral: binding.debt,
    debt: binding.collateral,
    collateralSymbol: "USDG",
    debtSymbol: symbol,
    collateralDecimals: 6,
    debtDecimals: 18,
    codeHashes: {
      pair: await getCodeHash(shortPair),
      registry: draft.registryCodeHash,
      oracle: await getCodeHash(reverse),
      collateral: long.codeHashes.debt,
      debt: long.codeHashes.collateral,
    },
  };
  const descriptor = {
    chainId: 46630,
    owner: deployer.address,
    router: marginRouter,
    factory: draft.factory,
    pool,
    longPair,
    short,
    codeHashes: {
      router: await getCodeHash(marginRouter),
      factory: draft.factoryCodeHash,
      pool: draft.poolCodeHash,
    },
    policy: JSON.parse(env.RH_MARGIN_PLAN_JSON).policy,
  };
  const profiles = [".env.testnet", ".env", "apps/web/.env"].map((path) => {
    const e = parseEnv(readFileSync(path, "utf8"));
    assert(e.NETWORK_MODE === "TESTNET", "PROFILE_NETWORK_MISMATCH");
    const collection = marketConfiguration.marketDeploymentsSchema.parse(
      JSON.parse(e.MARKET_DEPLOYMENTS_JSON),
    );
    const previous = collection.find((x) => x.symbol === symbol);
    assert(
      !previous ||
        (!previous.enabled &&
          same(previous.long.pair, longPair) &&
          same(previous.margin.router, marginRouter)),
      "EXISTING_MARKET_CONFLICT",
    );
    const next = marketConfiguration.marketDeploymentsSchema.parse([
      ...collection.filter((x) => x.symbol !== symbol),
      { symbol, enabled: false, long, margin: descriptor },
    ]);
    return { path, next };
  });
  entry.descriptor = { long, margin: descriptor };
  entry.deploymentComplete = true;
  entry.liveAcceptancePassed = false;
  ctx.persist();
  for (const { path, next } of profiles)
    updateEnv(path, {
      [`RH_${symbol}_LENDING_DEPLOYMENT_JSON`]: JSON.stringify(long),
      [`RH_${symbol}_MARGIN_DEPLOYMENT_JSON`]: JSON.stringify(descriptor),
      MARKET_DEPLOYMENTS_JSON: JSON.stringify(next),
    });
  mkdirSync("docs/evidence/rh-expansion-live", { recursive: true });
  save(`docs/evidence/rh-expansion-live/${symbol.toLowerCase()}.json`, {
    capturedAt: new Date().toISOString(),
    chainId: 46630,
    symbol,
    scopeHash,
    descriptor: entry.descriptor,
    paused: true,
    applicationEnabled: false,
    liveAcceptancePassed: false,
    transactions: Object.entries(state.operations)
      .filter(([key]) => key.startsWith(`${prefix}-`))
      .map(([operation, op]) => ({
        operation,
        hash: op.hash,
        block: op.receipt?.blockNumber,
        status: op.receipt?.status,
      })),
  });
  console.log(
    json({
      symbol,
      status: "DEPLOYED_FUNDED_PAUSED",
      liveAcceptancePassed: false,
      applicationEnabled: false,
    }),
  );
} catch (error) {
  safeFailure(error);
} finally {
  release?.();
}
