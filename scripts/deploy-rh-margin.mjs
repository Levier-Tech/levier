import { parseReferenceTransport } from "../apps/price-oracle/src/services/referenceTransport.ts";
import { parseRobinhoodTransport } from "../apps/price-oracle/src/services/robinhoodTransport.ts";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import marketConfiguration from "../apps/web/config/market-deployments.cjs";
import {
  context,
  artifact,
  assert,
  same,
  json,
  save,
  submit,
  verifyRuntime,
  verifyBinding,
  updateEnv,
  v,
  safeFailure,
} from "./lib/rh-live.mjs";
import { acquireLock } from "./lib/process-lock.mjs";
import { fetchTestnetReport } from "../apps/price-oracle/src/services/testnetReference.ts";
let release;
try {
  assert(
    process.argv.length === 3 && process.argv[2] === ".env.testnet",
    "EXPLICIT_TESTNET_PROFILE_REQUIRED",
  );
  release = acquireLock(".secrets/rh-live/operations.lock");
  const ctx = await context(process.argv[2]);
  const { client, state, env, deployer } = ctx,
    d = state.descriptor,
    binding = JSON.parse(env.RH_REFERENCE_BINDING_JSON),
    plan = JSON.parse(env.RH_MARGIN_PLAN_JSON);
  assert(
    plan.version === 1 && d && state.acceptanceComplete,
    "MARGIN_PLAN_REQUIRED",
  );
  assert(
    !Object.values(state.operations).some(
      (o) => !o.receipt || o.receipt.status !== "success",
    ),
    "UNRESOLVED_TRANSACTION",
  );
  await verifyBinding(ctx, binding);
  await verifyRuntime(client, d.pair, "LeveraPair");
  const existing = await client.readContract({
    address: d.pair,
    abi: artifact("LeveraPair").abi,
    functionName: "accounts",
    args: [deployer.address],
  });
  assert(
    existing[0] === 0n && existing[1] === 0n,
    "DEPLOYER_POSITION_NOT_EMPTY",
  );
  state.margin ??= {};
  const m = state.margin;
  ctx.persist();
  const raw = (name) =>
    JSON.parse(
      readFileSync(
        `packages/contracts/vendor/uniswap-v2-core/build/${name}.json`,
        "utf8",
      ),
    );
  const hex = (s) => (s.startsWith("0x") ? s : `0x${s}`);
  const call = async (id, address, abi, functionName, args) =>
    submit(ctx, `margin-v1-${id}`, deployer, {
      to: address,
      data: v.encodeFunctionData({ abi, functionName, args }),
    });
  async function deploy(role, name, args, vendor = false) {
    const a = vendor ? raw(name) : artifact(name);
    const bytecode = vendor ? hex(a.bytecode) : a.bytecode;
    if (!m[role]) {
      const r = await submit(ctx, `margin-v1-deploy-${role}`, deployer, {
        data: v.encodeDeployData({ abi: a.abi, bytecode, args }),
      });
      m[role] = r.contractAddress;
      ctx.persist();
    }
    const code = await client.getCode({ address: m[role] });
    if (vendor)
      assert(
        code === hex(a.evm.deployedBytecode.object),
        "V2_RUNTIME_MISMATCH",
      );
    else await verifyRuntime(client, m[role], name);
    m[`${role}CodeHash`] = v.keccak256(code);
    ctx.persist();
    console.log(json({ role, address: m[role], verified: true }));
  }
  await deploy("factory", "UniswapV2Factory", [deployer.address], true);
  const factory = raw("UniswapV2Factory"),
    poolArtifact = raw("UniswapV2Pair");
  let pool = await client.readContract({
    address: m.factory,
    abi: factory.abi,
    functionName: "getPair",
    args: [d.collateral, d.debt],
  });
  if (BigInt(pool) === 0n) {
    await call("create-pool", m.factory, factory.abi, "createPair", [
      d.collateral,
      d.debt,
    ]);
    pool = await client.readContract({
      address: m.factory,
      abi: factory.abi,
      functionName: "getPair",
      args: [d.collateral, d.debt],
    });
  }
  assert(
    (await client.getCode({ address: pool })) ===
      hex(poolArtifact.evm.deployedBytecode.object),
    "V2_POOL_RUNTIME_MISMATCH",
  );
  m.pool = pool;
  m.poolCodeHash = v.keccak256(await client.getCode({ address: pool }));
  ctx.persist();
  await deploy("shortOracle", "RhShortReferenceOracle", [
    d.oracle,
    v.keccak256(v.toHex(JSON.stringify(binding))),
    d.collateral,
    d.debt,
    BigInt(binding.maxSpreadBps),
  ]);
  const shortId = v.keccak256(
    v.encodePacked(
      ["string", "address", "address"],
      [plan.shortSlug, d.debt, d.collateral],
    ),
  );
  await deploy("shortPair", "LeveraPair", [
    shortId,
    d.debt,
    d.collateral,
    m.shortOracle,
    d.registry,
    deployer.address,
  ]);
  const registry = artifact("LeveraMarketRegistry").abi;
  const ids = await client.readContract({
    address: d.registry,
    abi: registry,
    functionName: "getMarketCount",
  });
  let registered = false;
  for (let i = 0n; i < ids; i++)
    if (
      same(
        await client.readContract({
          address: d.registry,
          abi: registry,
          functionName: "allMarketIds",
          args: [i],
        }),
        shortId,
      )
    )
      registered = true;
  if (!registered)
    await call("register-short", d.registry, registry, "addMarket", [
      plan.shortSlug,
      d.debt,
      d.collateral,
      m.shortPair,
      m.shortOracle,
      3,
      0n,
      BigInt(plan.shortLiquidationLtvBps),
      BigInt(plan.shortMaxLeverageBps),
      BigInt(plan.shortSupplyCapRaw),
      BigInt(plan.shortBorrowCapRaw),
    ]);
  await call("pause-short", d.registry, registry, "setMarketStatus", [
    shortId,
    2,
  ]);
  await call("risk-short", d.registry, registry, "updateRiskTier", [
    shortId,
    3,
    BigInt(plan.shortMaxLtvBps),
    BigInt(plan.shortLiquidationLtvBps),
    BigInt(plan.shortMaxLeverageBps),
  ]);
  await deploy("router", "MarginRouter", [
    d.collateral,
    d.debt,
    d.pair,
    m.shortPair,
    m.pool,
    deployer.address,
  ]);
  const router = artifact("MarginRouter").abi;
  if (!m.seed) {
    const prices = await fetchTestnetReport(binding, {
      timeoutMs: Number(env.ORACLE_HTTP_TIMEOUT_MS),
      maxResponseBytes: Number(env.ORACLE_MAX_RESPONSE_BYTES), robinhoodTransport: parseRobinhoodTransport(env.ROBINHOOD_TRANSPORT_JSON), usdgTransport: parseReferenceTransport(env.USDG_TRANSPORT_JSON),
    });
    const stableRaw = BigInt(plan.seedStableRaw),
      stockRaw =
        (stableRaw *
          BigInt(prices.debtPrice18) *
          10n ** BigInt(d.collateralDecimals)) /
        (10n ** BigInt(d.debtDecimals) * BigInt(prices.collateralPrice18));
    assert(
      stockRaw > 0n && stockRaw <= BigInt(plan.maxSeedStockRaw),
      "SEED_STOCK_BUDGET_EXCEEDED",
    );
    m.seed = {
      stockRaw: String(stockRaw),
      stableRaw: String(stableRaw),
      reference: prices,
      deadline: String((await client.getBlock()).timestamp + 1800n),
    };
    ctx.persist();
  }
  await call("approve-seed-stock", d.collateral, v.erc20Abi, "approve", [
    m.router,
    BigInt(m.seed.stockRaw),
  ]);
  await call("approve-seed-stable", d.debt, v.erc20Abi, "approve", [
    m.router,
    BigInt(m.seed.stableRaw),
  ]);
  await call("seed-pool", m.router, router, "seedLiquidity", [
    BigInt(m.seed.stockRaw),
    BigInt(m.seed.stableRaw),
    1n,
    BigInt(m.seed.deadline),
  ]);
  await call("fund-short", d.collateral, v.erc20Abi, "transfer", [
    m.shortPair,
    BigInt(plan.shortLiquidityRaw),
  ]);
  await call("authorize-router", d.registry, registry, "setAuthorizedRouter", [
    m.router,
    true,
  ]);
  await call("unpause-router", m.router, router, "setPaused", [false]);
  const short = {
    chainId: d.chainId,
    marketId: shortId,
    pair: m.shortPair,
    registry: d.registry,
    oracle: m.shortOracle,
    collateral: d.debt,
    debt: d.collateral,
    collateralSymbol: d.debtSymbol,
    debtSymbol: d.collateralSymbol,
    collateralDecimals: d.debtDecimals,
    debtDecimals: d.collateralDecimals,
    codeHashes: {
      pair: m.shortPairCodeHash,
      registry: d.codeHashes.registry,
      oracle: m.shortOracleCodeHash,
      collateral: d.codeHashes.debt,
      debt: d.codeHashes.collateral,
    },
  };
  const descriptor = {
    chainId: d.chainId,
    owner: deployer.address,
    router: m.router,
    factory: m.factory,
    pool: m.pool,
    longPair: d.pair,
    short,
    codeHashes: {
      router: m.routerCodeHash,
      factory: m.factoryCodeHash,
      pool: m.poolCodeHash,
    },
    policy: plan.policy,
  };
  m.descriptor = descriptor;
  ctx.persist();
  const profileUpdates = [".env.testnet", ".env", "apps/web/.env"].map((path) => {
    const raw = parseEnv(readFileSync(path, "utf8"));
    let existing;
    try {
      existing = marketConfiguration.marketDeploymentsSchema.parse(JSON.parse(raw.MARKET_DEPLOYMENTS_JSON));
    } catch { throw Error("MARKET_COLLECTION_INVALID"); }
    const previous = existing.find((row) => row.symbol === d.collateralSymbol);
    const next = [
      ...existing.filter((row) => row.symbol !== d.collateralSymbol),
      { symbol: d.collateralSymbol, enabled: previous?.enabled === true, long: d, margin: descriptor },
    ];
    const checked = marketConfiguration.marketDeploymentsSchema.safeParse(next);
    assert(checked.success, "MARKET_COLLECTION_IDENTITY_MISMATCH");
    return { path, collection: checked.data };
  });
  for (const { path, collection } of profileUpdates)
    updateEnv(path, {
      MARGIN_DEPLOYMENT_JSON: JSON.stringify(descriptor),
      MARKET_DEPLOYMENTS_JSON: JSON.stringify(collection),
      MARGIN_TRADING_ENABLED: "false",
    });
  mkdirSync("docs/evidence/rh-margin", { recursive: true });
  writeFileSync(
    "docs/evidence/rh-margin/deployment.json",
    json({
      capturedAt: new Date().toISOString(),
      descriptor,
      seed: { stockRaw: m.seed.stockRaw, stableRaw: m.seed.stableRaw },
      lpBalance: await client.readContract({
        address: m.pool,
        abi: poolArtifact.abi,
        functionName: "balanceOf",
        args: [deployer.address],
      }),
      transactions: Object.entries(state.operations)
        .filter(([id]) => id.startsWith("margin-v1-"))
        .map(([id, o]) => ({
          id,
          hash: o.hash,
          block: o.receipt.blockNumber,
          status: o.receipt.status,
          gasWei: o.receipt.gasUsed * o.receipt.effectiveGasPrice,
        })),
    }) + "\n",
  );
  console.log("MARGIN_DEPLOYMENT_VERIFIED_MARKETS_REMAIN_PAUSED");
} catch (error) {
  safeFailure(error);
} finally {
  release?.();
}
