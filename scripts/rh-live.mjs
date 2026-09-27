import { parseReferenceTransport } from "../apps/price-oracle/src/services/referenceTransport.ts";
import { fetchRobinhoodJson, parseRobinhoodTransport } from "../apps/price-oracle/src/services/robinhoodTransport.ts";
import { acquireLock } from "./lib/process-lock.mjs";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import {
  parseModulesConfig,
  moduleSpecs,
  verifyModuleInputs,
  verifyModule,
} from "./lib/rh-modules.mjs";
import {
  context,
  artifact,
  v,
  assert,
  same,
  json,
  save,
  updateEnv,
  fingerprint,
  verifyBinding,
  verifyRuntime,
  submit,
  safeFailure,
} from "./lib/rh-live.mjs";
import { fetchTestnetReport } from "../apps/price-oracle/src/services/testnetReference.ts";

const [mode, profile] = process.argv.slice(2);
try {
  acquireLock(".secrets/rh-live/operations.lock");
  assert(
    [
      "--prepare",
      "--check",
      "--deploy-base",
      "--deploy-modules",
      "--deploy-market",
      "--publish",
      "--acceptance",
      "--close-acceptance",
      "--verify",
    ].includes(mode),
    "EXPLICIT_OPERATION_REQUIRED",
  );
  const ctx = await context(profile);
  const { env, client, state, deployer, publisher } = ctx;
  const tokens = JSON.parse(env.PROTOCOL_ADDRESSES).tokens;
  const abis = Object.fromEntries(
    [
      "RhTestnetReferenceOracle",
      "LevierMarketRegistry",
      "LevierPair",
      "LevierRouter",
    ].map((n) => [n, artifact(n)]),
  );
  const read = (address, contract, name, args = []) =>
    client.readContract({
      address,
      abi: abis[contract].abi,
      functionName: name,
      args,
    });
  const invoke = (id, address, contract, name, args = [], account = deployer) =>
    submit(ctx, id, account, {
      to: address,
      data: v.encodeFunctionData({
        abi: abis[contract].abi,
        functionName: name,
        args,
      }),
    });
  async function deploy(name, args, role) {
    const receipt = await submit(ctx, `deploy-${role}`, deployer, {
      data: v.encodeDeployData({ ...abis[name], args }),
    });
    assert(receipt.contractAddress, "DEPLOYMENT_ADDRESS_MISSING");
    state[role] = receipt.contractAddress;
    state[`${role}CodeHash`] = await verifyRuntime(
      client,
      receipt.contractAddress,
      name,
    );
    ctx.persist();
    return receipt.contractAddress;
  }
  if (mode === "--prepare") {
    const updates = {};
    if (!env.RH_LIVE_EXECUTION_JSON)
      updates.RH_LIVE_EXECUTION_JSON = JSON.stringify({
        confirmations: 2,
        receiptTimeoutMs: 120000,
        maxTransactionGasCostWei: "1000000000000000",
        maxSignerGasCostWei: "3000000000000000",
        minimumGasReserveWei: "1000000000000000",
        slug: "tsla-usdg-testnet",
        maxLtvBps: 5000,
        liquidationLtvBps: 6500,
        supplyCapRaw: "2000000000000000000",
        borrowCapRaw: "10000000",
        liquidityRaw: "5000000",
        acceptanceCollateralRaw: "10000000000000000",
        acceptanceDebtRaw: "1000000",
      });
    if (!env.RH_REFERENCE_BINDING_JSON) {
      const assets = await fetchRobinhoodJson(new URL("assets", env.ROBINHOOD_STOCK_API_URL), {
        timeoutMs: Number(env.ORACLE_HTTP_TIMEOUT_MS),
        maxResponseBytes: Number(env.ORACLE_MAX_RESPONSE_BYTES),
      }, parseRobinhoodTransport(env.ROBINHOOD_TRANSPORT_JSON));
      const stock = assets.assets.filter((a) => a.tokenSymbol === "TSLA");
      assert(stock.length === 1, "STOCK_METADATA_UNAVAILABLE");
      const metadata = v.parseAbi([
        "function uid() view returns(bytes32)",
        "function uiMultiplier() view returns(uint256)",
      ]);
      const binding = {
        mode: "RH_TESTNET_REAL_REFERENCE",
        chainId: 46630,
        stockApiUrl: env.ROBINHOOD_STOCK_API_URL,
        usdgBookUrl: "wss://ws.kraken.com/v2",
        stockSourceId: stock[0].id,
        stockSymbol: "TSLA",
        collateral: tokens.TSLA,
        debt: tokens.USDG,
        testnetStockUid: await client.readContract({
          address: tokens.TSLA,
          abi: metadata,
          functionName: "uid",
        }),
        multiplier18: String(
          await client.readContract({
            address: tokens.TSLA,
            abi: metadata,
            functionName: "uiMultiplier",
          }),
        ),
        stockMaxAgeSeconds: 90,
        debtMaxAgeSeconds: 600,
        maxSpreadBps: 50,
        stockMin18: "1000000000000000000",
        stockMax18: "1000000000000000000000",
        debtMin18: "900000000000000000",
        debtMax18: "1100000000000000000",
        maxDeviationBps: 500,
        tokenFingerprints: {
          collateral: await fingerprint(client, tokens.TSLA),
          debt: await fingerprint(client, tokens.USDG),
        },
      };
      updates.RH_REFERENCE_BINDING_JSON = JSON.stringify(binding);
    }
    if (!env.RH_REFERENCE_ORACLE_APPROVED)
      updates.RH_REFERENCE_ORACLE_APPROVED = "false";
    updateEnv(profile, updates);
    console.log("TESTNET_CONFIGURATION_PREPARED_NO_TRANSACTIONS");
  } else if (mode === "--deploy-base") {
    // Independent of the reference-oracle choice. No market can borrow yet.
    await deploy("LevierMarketRegistry", [deployer.address], "registry");
    assert(
      same(
        await read(state.registry, "LevierMarketRegistry", "owner"),
        deployer.address,
      ),
      "REGISTRY_OWNER_MISMATCH",
    );
    await deploy("LevierRouter", [], "router");
    await invoke(
      "authorize-router",
      state.registry,
      "LevierMarketRegistry",
      "setAuthorizedRouter",
      [state.router, true],
    );
    assert(
      await read(state.registry, "LevierMarketRegistry", "isAuthorizedRouter", [
        state.router,
      ]),
      "ROUTER_NOT_AUTHORIZED",
    );
    assert(
      (await read(state.registry, "LevierMarketRegistry", "getMarketCount")) ===
        0n,
      "UNEXPECTED_EXISTING_MARKETS",
    );
    console.log(
      json({
        stage: "base-contracts-verified",
        registry: state.registry,
        router: state.router,
        markets: 0,
      }),
    );
  } else if (mode === "--deploy-modules") {
    const config = parseModulesConfig(env.RH_MODULES_CONFIG_JSON);
    await verifyModuleInputs(ctx, config);
    const manifest = { chainId: 46630, modules: {}, executionEnabled: false };
    for (const spec of moduleSpecs(config, deployer.address)) {
      const receipt = await submit(ctx, `deploy-${spec.role}`, deployer, {
        data: v.encodeDeployData({
          ...artifact(spec.contract),
          args: spec.args,
        }),
      });
      assert(receipt.contractAddress, "DEPLOYMENT_ADDRESS_MISSING");
      const codeHash = await verifyModule(
        ctx,
        config,
        spec,
        receipt.contractAddress,
      );
      state[spec.role] = receipt.contractAddress;
      state[`${spec.role}CodeHash`] = codeHash;
      ctx.persist();
      manifest.modules[spec.role] = {
        address: receipt.contractAddress,
        codeHash,
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber),
        initialState: "paused",
      };
    }
    save(`${ctx.directory}/modules-manifest.json`, manifest);
    // Export only verified public contract identities, with both UI execution gates still closed.
    for (const path of [".env.testnet", ".env", "apps/web/.env"]) {
      const target = parseEnv(readFileSync(path, "utf8"));
      assert(
        target.NETWORK_MODE === "TESTNET" &&
          target.CHAIN_ID === "46630" &&
          target.LENDING_ENABLED === "false" &&
          target.TRADING_ENABLED === "false",
        "MODULE_ENV_EXPORT_GUARD",
      );
      const addresses = JSON.parse(target.PROTOCOL_ADDRESSES);
      for (const [role, module] of Object.entries(manifest.modules))
        addresses[role] = module.address;
      const updates = { PROTOCOL_ADDRESSES: JSON.stringify(addresses) };
      if (path !== "apps/web/.env")
        Object.assign(updates, {
          LEVERAGE_ROUTER_ADDRESS: state.leverageRouter,
          SHORT_ROUTER_ADDRESS: state.shortRouter,
          AUTO_PROTECT_ADDRESS: state.autoProtect,
          LEVIER_VAULT_ADDRESS: state.levierVault,
        });
      updateEnv(path, updates);
    }
    console.log("FOUR_MODULES_DEPLOYED_VERIFIED_PAUSED");
  } else {
    const binding = JSON.parse(env.RH_REFERENCE_BINDING_JSON);
    await verifyBinding(ctx, binding);
    const bindingHash = v.keccak256(v.toHex(JSON.stringify(binding)));
    const policy = JSON.parse(env.RH_LIVE_EXECUTION_JSON);
    const report = async () =>
      fetchTestnetReport(binding, {
        timeoutMs: Number(env.ORACLE_HTTP_TIMEOUT_MS),
        maxResponseBytes: Number(env.ORACLE_MAX_RESPONSE_BYTES), robinhoodTransport: parseRobinhoodTransport(env.ROBINHOOD_TRANSPORT_JSON), usdgTransport: parseReferenceTransport(env.USDG_TRANSPORT_JSON),
      });
    async function publish() {
      assert(
        env.RH_REFERENCE_ORACLE_APPROVED === "true",
        "REFERENCE_ORACLE_APPROVAL_REQUIRED",
      );
      assert(state.oracle, "ORACLE_DEPLOYMENT_REQUIRED");
      assert(
        same(
          await read(state.oracle, "RhTestnetReferenceOracle", "publisher"),
          publisher.address,
        ) &&
          same(
            await read(state.oracle, "RhTestnetReferenceOracle", "bindingHash"),
            bindingHash,
          ),
        "ORACLE_BINDING_MISMATCH",
      );
      const prices = await report();
      const evidence = v.keccak256(v.toHex(json(prices)));
      save(
        `${ctx.directory}/reference-${prices.collateralTimestamp}-${prices.debtTimestamp}.json`,
        prices,
      );
      const oldStock = await read(
        state.oracle,
        "RhTestnetReferenceOracle",
        "observations",
        [binding.collateral],
      );
      const oldDebt = await read(
        state.oracle,
        "RhTestnetReferenceOracle",
        "observations",
        [binding.debt],
      );
      if (
        oldStock[1] === BigInt(prices.collateralTimestamp) &&
        oldDebt[1] === BigInt(prices.debtTimestamp)
      )
        return prices;
      await invoke(
        `publish-${prices.collateralTimestamp}-${prices.debtTimestamp}`,
        state.oracle,
        "RhTestnetReferenceOracle",
        "publish",
        [
          BigInt(prices.collateralPrice18),
          BigInt(prices.collateralTimestamp),
          BigInt(prices.debtPrice18),
          BigInt(prices.debtTimestamp),
          evidence,
        ],
        publisher,
      );
      return prices;
    }
    if (mode === "--check") {
      const prices = await report();
      save(`${ctx.directory}/source-check.json`, prices);
      console.log(json({ stage: "source-check", ...prices }));
    }
    if (mode === "--deploy-market") {
      assert(!state.descriptor, "MARKET_ALREADY_DEPLOYED_USE_VERIFICATION");
      assert(
        env.RH_REFERENCE_ORACLE_APPROVED === "true",
        "REFERENCE_ORACLE_APPROVAL_REQUIRED",
      );
      assert(state.registry && state.router, "BASE_DEPLOYMENT_REQUIRED");
      await report();
      await deploy(
        "RhTestnetReferenceOracle",
        [
          publisher.address,
          bindingHash,
          [
            binding.collateral,
            BigInt(binding.stockMaxAgeSeconds),
            BigInt(binding.stockMin18),
            BigInt(binding.stockMax18),
          ],
          [
            binding.debt,
            BigInt(binding.debtMaxAgeSeconds),
            BigInt(binding.debtMin18),
            BigInt(binding.debtMax18),
          ],
          BigInt(binding.maxDeviationBps),
        ],
        "oracle",
      );
      await publish();
      state.marketId = v.keccak256(
        v.encodePacked(
          ["string", "address", "address"],
          [policy.slug, binding.collateral, binding.debt],
        ),
      );
      ctx.persist();
      await deploy(
        "LevierPair",
        [
          state.marketId,
          binding.collateral,
          binding.debt,
          state.oracle,
          state.registry,
          deployer.address,
        ],
        "pair",
      );
      // Register with a zero LTV so the brief add/pause interval cannot permit borrowing.
      await invoke(
        "register-market",
        state.registry,
        "LevierMarketRegistry",
        "addMarket",
        [
          policy.slug,
          binding.collateral,
          binding.debt,
          state.pair,
          state.oracle,
          3,
          0n,
          BigInt(policy.liquidationLtvBps),
          10000n,
          BigInt(policy.supplyCapRaw),
          BigInt(policy.borrowCapRaw),
        ],
      );
      await invoke(
        "pause-market",
        state.registry,
        "LevierMarketRegistry",
        "setMarketStatus",
        [state.marketId, 2],
      );
      await invoke(
        "configure-risk",
        state.registry,
        "LevierMarketRegistry",
        "updateRiskTier",
        [
          state.marketId,
          3,
          BigInt(policy.maxLtvBps),
          BigInt(policy.liquidationLtvBps),
          10000n,
        ],
      );
      const market = await read(
        state.registry,
        "LevierMarketRegistry",
        "getMarket",
        [state.marketId],
      );
      assert(market.status === 2, "MARKET_NOT_PAUSED");
      const descriptor = {
        chainId: 46630,
        marketId: state.marketId,
        pair: state.pair,
        registry: state.registry,
        oracle: state.oracle,
        collateral: binding.collateral,
        debt: binding.debt,
        collateralSymbol: "TSLA",
        debtSymbol: "USDG",
        collateralDecimals: await client.readContract({
          address: binding.collateral,
          abi: v.erc20Abi,
          functionName: "decimals",
        }),
        debtDecimals: await client.readContract({
          address: binding.debt,
          abi: v.erc20Abi,
          functionName: "decimals",
        }),
        codeHashes: {},
      };
      for (const role of ["pair", "registry", "oracle", "collateral", "debt"])
        descriptor.codeHashes[role] = v.keccak256(
          await client.getCode({ address: descriptor[role] }),
        );
      state.descriptor = descriptor;
      ctx.persist();
      console.log(
        json({
          stage: "market-deployed-paused",
          pair: state.pair,
          marketId: state.marketId,
        }),
      );
    }
    if (mode === "--publish") await publish();
    if (mode === "--close-acceptance") {
      // Debt repayment and debt-free exit must not depend on an available price feed.
      assert(
        state.descriptor && state.acceptanceBefore,
        "ACCEPTANCE_POSITION_REQUIRED",
      );
      const { readLendingSnapshot, verifyPairEvent } =
        await import("../apps/web/src/lib/lending-client.ts");
      let snapshot = await readLendingSnapshot(
        client,
        state.descriptor,
        deployer.address,
      );
      assert(
        snapshot.debt <= BigInt(policy.acceptanceDebtRaw) &&
          snapshot.collateral <= BigInt(policy.acceptanceCollateralRaw),
        "RECOVERY_EXCEEDS_ACCEPTANCE_SCOPE",
      );
      if (snapshot.debt > 0n) {
        assert(
          snapshot.debt === BigInt(policy.acceptanceDebtRaw),
          "RECOVERY_DEBT_CHANGED",
        );
        await submit(ctx, "acceptance-approve-repay", deployer, {
          to: binding.debt,
          data: v.encodeFunctionData({
            abi: v.erc20Abi,
            functionName: "approve",
            args: [state.pair, snapshot.debt],
          }),
        });
        const receipt = await invoke(
          "acceptance-repay",
          state.pair,
          "LevierPair",
          "repay",
          [snapshot.debt],
        );
        verifyPairEvent(
          receipt.logs,
          state.descriptor,
          deployer.address,
          "repay",
          snapshot.debt,
        );
      }
      snapshot = await readLendingSnapshot(
        client,
        state.descriptor,
        deployer.address,
      );
      assert(snapshot.debt === 0n, "RECOVERY_DEBT_NOT_CLOSED");
      if (snapshot.collateral > 0n) {
        assert(
          snapshot.collateral === BigInt(policy.acceptanceCollateralRaw),
          "RECOVERY_COLLATERAL_CHANGED",
        );
        const receipt = await invoke(
          "acceptance-withdraw",
          state.pair,
          "LevierPair",
          "withdrawCollateral",
          [snapshot.collateral],
        );
        verifyPairEvent(
          receipt.logs,
          state.descriptor,
          deployer.address,
          "withdraw",
          snapshot.collateral,
        );
      }
      await invoke(
        "pause-after-acceptance",
        state.registry,
        "LevierMarketRegistry",
        "setMarketStatus",
        [state.marketId, 2],
      );
      state.recoveryComplete = true;
      ctx.persist();
      console.log("ACCEPTANCE_POSITION_CLOSED_MARKET_PAUSED");
    }
    if (mode === "--acceptance") {
      assert(
        !state.acceptanceComplete,
        "ACCEPTANCE_ALREADY_COMPLETE_USE_FINALIZE",
      );
      assert(
        env.RH_REFERENCE_ORACLE_APPROVED === "true",
        "REFERENCE_ORACLE_APPROVAL_REQUIRED",
      );
      assert(state.descriptor, "MARKET_DEPLOYMENT_REQUIRED");
      const { readLendingSnapshot, verifyPairEvent } =
        await import("../apps/web/src/lib/lending-client.ts");
      const initial = await readLendingSnapshot(
        client,
        state.descriptor,
        deployer.address,
      );
      if (!state.acceptanceBefore) {
        assert(
          initial.collateral === 0n && initial.debt === 0n,
          "ACCEPTANCE_ACCOUNT_MUST_BE_EMPTY",
        );
        state.acceptanceBefore = initial;
        ctx.persist();
      }
      await publish();
      const erc = (id, token, name, args) =>
        submit(ctx, id, deployer, {
          to: token,
          data: v.encodeFunctionData({
            abi: v.erc20Abi,
            functionName: name,
            args,
          }),
        });
      // This is protocol-owned testnet seed liquidity, not a redeemable supplier deposit.
      await erc("seed-liquidity", binding.debt, "transfer", [
        state.pair,
        BigInt(policy.liquidityRaw),
      ]);
      await invoke(
        "activate-market",
        state.registry,
        "LevierMarketRegistry",
        "setMarketStatus",
        [state.marketId, 0],
      );
      for (const [action, method, token, amount] of [
        [
          "deposit",
          "depositCollateral",
          binding.collateral,
          BigInt(policy.acceptanceCollateralRaw),
        ],
        ["borrow", "borrow", binding.debt, BigInt(policy.acceptanceDebtRaw)],
        ["repay", "repay", binding.debt, BigInt(policy.acceptanceDebtRaw)],
        [
          "withdraw",
          "withdrawCollateral",
          binding.collateral,
          BigInt(policy.acceptanceCollateralRaw),
        ],
      ]) {
        if (action === "borrow") await publish();
        if (action === "deposit" || action === "repay")
          await erc(`acceptance-approve-${action}`, token, "approve", [
            state.pair,
            amount,
          ]);
        const receipt = await invoke(
          `acceptance-${action}`,
          state.pair,
          "LevierPair",
          method,
          [amount],
        );
        verifyPairEvent(
          receipt.logs,
          state.descriptor,
          deployer.address,
          action,
          amount,
        );
      }
      const after = await readLendingSnapshot(
        client,
        state.descriptor,
        deployer.address,
      );
      assert(
        after.collateral === 0n && after.debt === 0n,
        "ACCEPTANCE_POSITION_NOT_CLOSED",
      );
      assert(
        after.collateralBalance ===
          BigInt(state.acceptanceBefore.collateralBalance),
        "COLLATERAL_NOT_RETURNED",
      );
      assert(
        after.debtBalance ===
          BigInt(state.acceptanceBefore.debtBalance) -
            BigInt(policy.liquidityRaw),
        "DEBT_BALANCE_MISMATCH",
      );
      assert(
        after.liquidity === BigInt(policy.liquidityRaw),
        "SEED_LIQUIDITY_MISMATCH",
      );
      state.acceptanceAfter = after;
      ctx.persist();
      // Acceptance does not establish a running publisher or activate the browser release.
      await invoke(
        "pause-after-acceptance",
        state.registry,
        "LevierMarketRegistry",
        "setMarketStatus",
        [state.marketId, 2],
      );
      assert(
        (
          await read(state.registry, "LevierMarketRegistry", "getMarket", [
            state.marketId,
          ])
        ).status === 2,
        "ACCEPTANCE_MARKET_NOT_PAUSED",
      );
      state.acceptanceComplete = true;
      ctx.persist();
      console.log("FUNDED_LENDING_LIFECYCLE_PASSED");
    }
    if (mode === "--verify") {
      assert(state.descriptor, "MARKET_DEPLOYMENT_REQUIRED");
      const { readLendingSnapshot } =
        await import("../apps/web/src/lib/lending-client.ts");
      const snapshot = await readLendingSnapshot(
        client,
        state.descriptor,
        env.TESTER_ADDRESS,
      );
      console.log(
        json({
          stage: "tester-market-verification",
          snapshot,
          acceptanceComplete: state.acceptanceComplete === true,
        }),
      );
    }
  }
} catch (error) {
  safeFailure(error);
}
