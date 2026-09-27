import { chargedGasCost } from "./lib/rh-gas-ledger.mjs";
import {
  readFileSync,
  statSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { parseEnv, isDeepStrictEqual } from "node:util";
import { execFileSync } from "node:child_process";
import { acquireLock } from "./lib/process-lock.mjs";
import {
  v,
  assert,
  same,
  fingerprint,
  artifact,
  updateEnv,
  verifyBinding,
} from "./lib/rh-live.mjs";
import { readMarketScope } from "./lib/rh-market-scope.mjs";
import {
  parseExpansionPlan,
  buildExpansionBinding,
  seedRequirements,
  assertFreshReport,
  referenceOracleArgs,
} from "./lib/rh-expansion.mjs";
import {
  fetchRobinhoodJson,
  parseRobinhoodTransport,
} from "../apps/price-oracle/src/services/robinhoodTransport.ts";
import { parseReferenceTransport } from "../apps/price-oracle/src/services/referenceTransport.ts";
import { fetchTestnetReport } from "../apps/price-oracle/src/services/testnetReference.ts";

// Public-client preparation only: no signer, wallet client, publication or broadcast.
try {
  const [profile, directory, mode] = process.argv.slice(2);
  assert(
    profile === ".env.testnet" &&
      /^docs\/evidence\/[a-z0-9-]+$/.test(directory ?? "") &&
      [undefined, "--write-bindings"].includes(mode),
    "EXPLICIT_PREPARATION_ARGUMENTS_REQUIRED",
  );
  const output = `${directory}/preparation.json`;
  assert(!existsSync(output), "EVIDENCE_ALREADY_EXISTS");
  if (mode) acquireLock(".secrets/rh-live/operations.lock");
  execFileSync("git", ["check-ignore", "-q", profile]);
  assert(
    !execFileSync("git", ["ls-files", "--", profile], {
      encoding: "utf8",
    }).trim(),
    "ENV_MUST_NOT_BE_TRACKED",
  );
  assert((statSync(profile).mode & 0o077) === 0, "ENV_PERMISSIONS_REQUIRED");
  const original = readFileSync(profile, "utf8"),
    env = parseEnv(original);
  const scope = readMarketScope(env),
    plan = parseExpansionPlan(env, scope);
  const template = JSON.parse(env.RH_REFERENCE_BINDING_JSON);
  assert(
    env.TRADING_ENABLED === "false",
    "LEGACY_TRADING_MUST_REMAIN_DISABLED",
  );
  const timeout = Number(env.RPC_TIMEOUT_MS),
    maxAge = Number(env.ANALYTICS_MAX_BLOCK_AGE_SECONDS);
  const http = {
    timeoutMs: Number(env.ORACLE_HTTP_TIMEOUT_MS),
    maxResponseBytes: Number(env.ORACLE_MAX_RESPONSE_BYTES),
    robinhoodTransport: parseRobinhoodTransport(env.ROBINHOOD_TRANSPORT_JSON),
    usdgTransport: parseReferenceTransport(env.USDG_TRANSPORT_JSON),
  };
  for (const n of [timeout, maxAge, http.timeoutMs, http.maxResponseBytes])
    assert(Number.isSafeInteger(n) && n > 0, "READ_POLICY_REQUIRED");
  const client = v.createPublicClient({
    transport: v.http(env.RPC_URL, { timeout, retryCount: 0 }),
    cacheTime: 0,
  });
  assert((await client.getChainId()) === plan.chainId, "RPC_CHAIN_MISMATCH");
  const blockNumber = await client.getBlockNumber(),
    block = await client.getBlock({ blockNumber });
  assert(block.hash, "BLOCK_HASH_REQUIRED");
  const tokens = JSON.parse(env.PROTOCOL_ADDRESSES).tokens;
  assert(
    same(env.USDG_ADDRESS, env.USDG_ISSUER_TESTNET_ADDRESS) &&
      same(env.USDG_ADDRESS, tokens.USDG) &&
      same(template.debt, tokens.USDG),
    "USDG_IDENTITY_MISMATCH",
  );
  const tokenRead = (address, functionName, args = []) =>
    client.readContract({
      address,
      abi: v.erc20Abi,
      functionName,
      args,
      blockNumber,
    });
  const [
    assets,
    stableFingerprint,
    stableSymbol,
    stableDecimals,
    stableBalance,
    gasBalance,
    gasPrice,
  ] = await Promise.all([
    fetchRobinhoodJson(
      new URL("assets", template.stockApiUrl),
      http,
      http.robinhoodTransport,
    ),
    fingerprint(client, env.USDG_ADDRESS, blockNumber),
    tokenRead(env.USDG_ADDRESS, "symbol"),
    tokenRead(env.USDG_ADDRESS, "decimals"),
    tokenRead(env.USDG_ADDRESS, "balanceOf", [env.DEPLOYER_ADDRESS]),
    client.getBalance({ address: env.DEPLOYER_ADDRESS, blockNumber }),
    client.getGasPrice(),
  ]);
  assert(
    stableSymbol === "USDG" && stableDecimals === 6,
    "USDG_METADATA_MISMATCH",
  );
  const metadata = v.parseAbi([
    "function uid() view returns(bytes32)",
    "function uiMultiplier() view returns(uint256)",
  ]);
  const updates = {},
    bindings = {},
    sources = {};
  const markets = await Promise.all(
    plan.assets.map(async (planned) => {
      const row = scope.find((x) => x.symbol === planned.symbol);
      assert(
        row.token && same(row.token, tokens[row.symbol]),
        "TOKEN_CONFIG_MISMATCH",
      );
      const [symbol, decimals, balance, uid, multiplier, tokenFingerprint] =
        await Promise.all([
          tokenRead(row.token, "symbol"),
          tokenRead(row.token, "decimals"),
          tokenRead(row.token, "balanceOf", [env.DEPLOYER_ADDRESS]),
          client.readContract({
            address: row.token,
            abi: metadata,
            functionName: "uid",
            blockNumber,
          }),
          client.readContract({
            address: row.token,
            abi: metadata,
            functionName: "uiMultiplier",
            blockNumber,
          }),
          fingerprint(client, row.token, blockNumber),
        ]);
      const candidate = buildExpansionBinding(
        template,
        row,
        assets,
        {
          symbol,
          decimals,
          uid,
          multiplier18: String(multiplier),
          fingerprint: tokenFingerprint,
        },
        stableFingerprint,
      );
      const name = `RH_${symbol}_REFERENCE_BINDING_JSON`;
      let binding = candidate;
      if (env[name]) {
        binding = JSON.parse(env[name]);
        // Do not silently rotate any existing immutable oracle source/policy identity.
        assert(
          isDeepStrictEqual(binding, candidate),
          "EXISTING_BINDING_CHANGED_REVIEW_REQUIRED",
        );
      }
      await verifyBinding({ env, client }, binding);
      const source = await fetchTestnetReport(binding, http);
      const funding = seedRequirements(planned, source, balance);
      const oracle = artifact("RhTestnetReferenceOracle");
      const data = v.encodeDeployData({
        ...oracle,
        args: referenceOracleArgs(binding, env.KEEPER_ADDRESS),
      });
      // A real RPC estimate for the first independent contract only, never the full batch.
      const estimatedGas = await client.estimateGas({
        account: env.DEPLOYER_ADDRESS,
        data,
      });
      if (!env[name]) updates[name] = JSON.stringify(binding);
      bindings[symbol] = binding;
      sources[symbol] = source;
      return {
        symbol,
        bindingHash: v.keccak256(v.toHex(JSON.stringify(binding))),
        bindingStatus: env[name]
          ? "existing-verified"
          : mode
            ? "prepared-for-env"
            : "candidate-not-persisted",
        referenceAssociation: "explicit-testnet-faucet-to-underlying-reference",
        nativeDeploymentVerified: false,
        onchain: {
          uid,
          multiplier18: String(multiplier),
          runtimeCodeHash: tokenFingerprint.codeHash,
          deployerBalance: v.formatUnits(balance, decimals),
        },
        reference: {
          stockSourceId: binding.stockSourceId,
          stockPriceUsd: v.formatUnits(BigInt(source.collateralPrice18), 18),
          usdgPriceUsd: v.formatUnits(BigInt(source.debtPrice18), 18),
          stockTimestamp: source.collateralTimestamp,
          usdgTimestamp: source.debtTimestamp,
        },
        funding,
        firstOracleEstimate: {
          gas: String(estimatedGas),
          gasPriceWei: String(gasPrice),
          feeEth: v.formatEther(estimatedGas * gasPrice),
          creationCodeHash: v.keccak256(data),
        },
        remainingContracts: [
          "longPair",
          "shortReferenceOracle",
          "shortPair",
          "v2Pool",
          "marginRouter",
        ],
        deploymentAccepted: false,
      };
    }),
  );
  const state = JSON.parse(readFileSync(".secrets/rh-live/state.json", "utf8"));
  assert(state.chainId === plan.chainId, "JOURNAL_CHAIN_MISMATCH");
  const policy = JSON.parse(env.RH_LIVE_EXECUTION_JSON);
  const reserved = Object.values(state.operations)
    .filter((x) => same(x.from, env.DEPLOYER_ADDRESS))
    .reduce((n, x) => n + chargedGasCost(x), 0n);
  const remaining = BigInt(policy.maxSignerGasCostWei) - reserved;
  const required = plan.assets.reduce(
    (n, x) => n + BigInt(x.seedStableRaw) + BigInt(x.longLiquidityRaw),
    0n,
  );
  const oracleFee = markets.reduce(
    (n, x) => n + BigInt(x.firstOracleEstimate.gas) * gasPrice,
    0n,
  );
  const blockers = [
    "FULL_DEPLOYMENT_GAS_ESTIMATE_REQUIRED",
    "PER_MARKET_RISK_AND_EXECUTION_MANIFEST_REQUIRED",
    "SHARED_REGISTRY_FACTORY_REVERIFICATION_REQUIRED",
    "MULTI_MARKET_PUBLISHER_AND_ACCEPTANCE_REQUIRED",
  ];
  if (stableBalance < required) blockers.push("USDG_FUNDING_SHORTFALL");
  for (const market of markets) {
    if (!market.funding.seedCapCovered)
      blockers.push(`${market.symbol}_SEED_CAP_TOO_LOW`);
    if (!market.funding.stockBalanceCovered)
      blockers.push(`${market.symbol}_STOCK_FUNDING_SHORTFALL`);
  }
  if (remaining < oracleFee)
    blockers.push("EXISTING_GAS_BUDGET_BELOW_FIRST_ORACLES_ESTIMATE");
  if (gasBalance <= oracleFee + BigInt(policy.minimumGasReserveWei))
    blockers.push("GAS_WALLET_RESERVE_SHORTFALL");
  assert(
    (await client.getBlock({ blockNumber })).hash === block.hash,
    "BLOCK_REORG",
  );
  const now = Math.floor(Date.now() / 1000);
  assert(
    now >= Number(block.timestamp) && now - Number(block.timestamp) <= maxAge,
    "BLOCK_EXPIRED",
  );
  for (const market of markets)
    assertFreshReport(bindings[market.symbol], sources[market.symbol], now);
  assert(
    readFileSync(profile, "utf8") === original,
    "ENV_CHANGED_DURING_PREPARATION",
  );
  const report = {
    version: 1,
    capturedAt: new Date().toISOString(),
    chainId: plan.chainId,
    block: String(blockNumber),
    blockHash: block.hash,
    policyOrigin:
      "Explicit bounds copied from existing RH_REFERENCE_BINDING_JSON; candidate policies only until per-market deployment review.",
    markets,
    stableFunding: {
      requiredUsdg: v.formatUnits(required, 6),
      availableUsdg: v.formatUnits(stableBalance, 6),
      shortfallUsdg: v.formatUnits(
        required > stableBalance ? required - stableBalance : 0n,
        6,
      ),
    },
    gas: {
      walletEth: v.formatEther(gasBalance),
      existingBudgetRemainingEth: v.formatEther(remaining),
      firstFourOraclesOnlyEstimatedFeeEth: v.formatEther(oracleFee),
      fullBatchEstimatedFeeEth: null,
      note: "eth_estimateGas at current price for four reference oracles only. Excludes all other contracts, approvals, liquidity, publication, acceptance and fee buffer. This is not a deployment budget.",
    },
    blockers,
    readyToDeploy: false,
    transactionsSubmitted: 0,
    bindingsWritten: mode ? Object.keys(updates).length : 0,
    note: "Point-in-time preparation, not live execution acceptance. Re-fetch prices, identities, fees and balances immediately before any future transaction. TSLA descriptors, liquidity budgets and execution gates are untouched.",
  };
  mkdirSync(directory, { recursive: true });
  // Only sanitized fields are written here; candidates themselves belong in ignored ENV.
  if (mode && Object.keys(updates).length) updateEnv(profile, updates);
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
} catch {
  console.error(
    "EXPANSION_PREPARATION_FAILED: check configuration, verified sources and token identity. Details redacted; no transaction submitted.",
  );
  process.exitCode = 1;
}
