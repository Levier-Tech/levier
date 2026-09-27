import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { acquireLock } from "./lib/process-lock.mjs";
import { chargedGasCost, receiptGasSettlement } from "./lib/rh-gas-ledger.mjs";

const require = createRequire(
  new URL("../apps/keeper/package.json", import.meta.url),
);
const v = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const profile = ".env.mainnet.core.local";
const directory = ".secrets/rh-mainnet-core";
const specs = [
  ["LeveraMarketRegistry", "MAINNET_MARKET_REGISTRY_ADDRESS", true],
  ["LeveraRouter", "MAINNET_LENDING_ROUTER_ADDRESS", false],
  ["AutoProtectModule", "MAINNET_AUTO_PROTECT_ADDRESS", true],
  ["ShortRouter", "MAINNET_SHORT_ROUTER_ADDRESS", true],
  ["LeveraVault", "MAINNET_LEVERA_VAULT_ADDRESS", true],
];
const check = (ok, code) => {
  if (!ok) throw Error(code);
};
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const json = (value) =>
  JSON.stringify(value, (_, x) => (typeof x === "bigint" ? String(x) : x), 2);
function save(path, value) {
  writeFileSync(`${path}.tmp`, `${json(value)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(`${path}.tmp`, path);
}
function privateUntracked(path) {
  execFileSync("git", ["check-ignore", "-q", path], { stdio: "pipe" });
  check(
    !execFileSync("git", ["ls-files", "--", path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim(),
    "PRIVATE_PATH_MUST_BE_UNTRACKED",
  );
  if (existsSync(path))
    check(
      (statSync(path).mode & 0o077) === 0,
      "PRIVATE_PATH_PERMISSIONS_REQUIRED",
    );
}
function positive(env, name) {
  check(/^[1-9][0-9]*$/.test(env[name] ?? ""), `${name}_REQUIRED`);
  return BigInt(env[name]);
}
function artifact(name, owner, owned, env) {
  const path = `packages/contracts/out/${name}.sol/${name}.json`;
  const a = JSON.parse(readFileSync(path, "utf8"));
  const metadata = a.metadata ?? JSON.parse(a.rawMetadata);
  for (const [source, info] of Object.entries(metadata.sources)) {
    const content = readFileSync(resolve("packages/contracts", source));
    check(
      v.keccak256(content) === info.keccak256,
      "ARTIFACT_SOURCE_CHANGED_REBUILD_REQUIRED",
    );
  }
  check(
    /^0x[0-9a-fA-F]+$/.test(a.bytecode.object),
    "ARTIFACT_BYTECODE_REQUIRED",
  );
  const args =
    name === "LeveraVault"
      ? [
          env.MAINNET_VAULT_ASSET_ADDRESS,
          env.MAINNET_VAULT_NAME,
          env.MAINNET_VAULT_SYMBOL,
          env.MAINNET_VAULT_SLUG,
          env.MAINNET_VAULT_RISK_TIER,
          owner,
        ]
      : owned
        ? [owner]
        : [];
  const data = v.encodeDeployData({
    abi: a.abi,
    bytecode: a.bytecode.object,
    args,
  });
  return {
    name,
    abi: a.abi,
    data,
    dataHash: v.keccak256(data),
    runtime: a.deployedBytecode.object,
    immutableReferences: a.deployedBytecode.immutableReferences ?? {},
  };
}

function normalizeRuntime(code, references) {
  let hex = code.slice(2).toLowerCase();
  for (const locations of Object.values(references))
    for (const { start, length } of locations)
      hex =
        hex.slice(0, start * 2) +
        "0".repeat(length * 2) +
        hex.slice((start + length) * 2);
  return hex;
}

let release;
let stage = "configuration";
try {
  const mode = process.argv[2];
  check(
    process.argv.length === 3 &&
      ["--plan", "--deploy", "--verify"].includes(mode),
    "EXPLICIT_MAINNET_CORE_MODE_REQUIRED",
  );
  privateUntracked(profile);
  const env = parseEnv(readFileSync(profile, "utf8"));
  if (mode === "--deploy")
    check(
      env.MAINNET_CORE_BROADCAST_ENABLED === "true",
      "MAINNET_BROADCAST_NOT_AUTHORIZED",
    );
  check(
    env.NETWORK_MODE === "MAINNET" && env.CHAIN_ID === "4663",
    "ROBINHOOD_MAINNET_REQUIRED",
  );
  check(env.MAINNET_DEPLOYMENT_SCOPE === "CORE_ONLY", "CORE_ONLY_REQUIRED");
  check(
    ["TRADING_ENABLED", "LENDING_ENABLED", "MARGIN_TRADING_ENABLED"].every(
      (k) => env[k] === "false",
    ),
    "MARKET_EXECUTION_MUST_STAY_DISABLED",
  );
  check(new URL(env.RPC_URL).protocol === "https:", "HTTPS_RPC_REQUIRED");
  const account = privateKeyToAccount(env.PRIVATE_KEY);
  check(
    same(account.address, env.DEPLOYER_ADDRESS),
    "SIGNER_IDENTITY_MISMATCH",
  );
  check(
    v.isAddress(env.PROTOCOL_OWNER_ADDRESS) &&
      !same(env.PROTOCOL_OWNER_ADDRESS, v.zeroAddress),
    "PROTOCOL_OWNER_REQUIRED",
  );
  const owner = v.getAddress(env.PROTOCOL_OWNER_ADDRESS);
  check(
    v.isAddress(env.MAINNET_VAULT_ASSET_ADDRESS) &&
      !same(env.MAINNET_VAULT_ASSET_ADDRESS, v.zeroAddress),
    "MAINNET_VAULT_ASSET_REQUIRED",
  );
  for (const key of [
    "MAINNET_VAULT_NAME",
    "MAINNET_VAULT_SYMBOL",
    "MAINNET_VAULT_SLUG",
    "MAINNET_VAULT_RISK_TIER",
  ])
    check(
      /^[A-Za-z0-9 _-]{1,80}$/.test(env[key] ?? ""),
      "VAULT_METADATA_REQUIRED",
    );
  check(
    /^0x[0-9a-fA-F]{64}$/.test(env.MAINNET_VAULT_ASSET_CODE_HASH ?? ""),
    "VAULT_ASSET_CODE_HASH_REQUIRED",
  );
  check(
    env.MAINNET_VAULT_ASSET_SYMBOL &&
      /^[0-9]+$/.test(env.MAINNET_VAULT_ASSET_DECIMALS ?? ""),
    "VAULT_ASSET_METADATA_REQUIRED",
  );
  const timeout = Number(positive(env, "MAINNET_RECEIPT_TIMEOUT_MS"));
  const confirmations = Number(positive(env, "MAINNET_RECEIPT_CONFIRMATIONS"));
  check(
    Number.isSafeInteger(timeout) && Number.isSafeInteger(confirmations),
    "INVALID_RECEIPT_POLICY",
  );
  const artifacts = specs.map(([name, , owned]) =>
    artifact(name, owner, owned, env),
  );
  privateUntracked(`${directory}/state.json`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  privateUntracked(directory);
  release = acquireLock(`${directory}/operations.lock`);
  const statePath = `${directory}/state.json`;
  const state = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf8"))
    : {
        chainId: Number(env.CHAIN_ID),
        deployer: account.address,
        owner,
        operations: {},
        complete: false,
      };
  check(
    state.chainId === Number(env.CHAIN_ID) &&
      same(state.deployer, account.address) &&
      same(state.owner, owner),
    "MAINNET_JOURNAL_IDENTITY_MISMATCH",
  );
  check(
    Object.keys(state.operations).every((name) =>
      artifacts.some((a) => a.name === name),
    ),
    "UNEXPECTED_CORE_OPERATION",
  );
  for (const [name, key] of specs)
    if (env[key]?.trim())
      check(
        state.operations[name] &&
          same(env[key], state.operations[name].address),
        "EXISTING_ADDRESS_REQUIRES_MATCHING_JOURNAL",
      );
  const persist = () => save(statePath, state);
  const chain = v.defineChain({
    id: Number(env.CHAIN_ID),
    name: env.CHAIN_NAME,
    nativeCurrency: {
      name: env.NATIVE_CURRENCY_NAME,
      symbol: env.NATIVE_CURRENCY_SYMBOL,
      decimals: Number(env.NATIVE_CURRENCY_DECIMALS),
    },
    rpcUrls: { default: { http: [env.RPC_URL] } },
  });
  check(
    chain.nativeCurrency.name &&
      chain.nativeCurrency.symbol &&
      env.NATIVE_CURRENCY_DECIMALS &&
      Number.isSafeInteger(chain.nativeCurrency.decimals),
    "NATIVE_CURRENCY_METADATA_REQUIRED",
  );
  const transport = v.http(env.RPC_URL, { timeout, retryCount: 0 });
  const client = v.createPublicClient({ chain, transport, cacheTime: 0 });
  const assertChain = async () =>
    check(
      (await client.getChainId()) === Number(env.CHAIN_ID),
      "RPC_CHAIN_MISMATCH",
    );
  const verifyAsset = async () => {
    const address = env.MAINNET_VAULT_ASSET_ADDRESS;
    const [code, symbol, decimals] = await Promise.all([
      client.getCode({ address }),
      client.readContract({ address, abi: v.erc20Abi, functionName: "symbol" }),
      client.readContract({
        address,
        abi: v.erc20Abi,
        functionName: "decimals",
      }),
    ]);
    check(
      code &&
        v.keccak256(code) === env.MAINNET_VAULT_ASSET_CODE_HASH &&
        symbol === env.MAINNET_VAULT_ASSET_SYMBOL &&
        String(decimals) === env.MAINNET_VAULT_ASSET_DECIMALS,
      "MAINNET_VAULT_ASSET_IDENTITY_CHANGED",
    );
  };
  const nonce = async () => {
    const [latest, pending] = await Promise.all(
      ["latest", "pending"].map((blockTag) =>
        client.getTransactionCount({ address: account.address, blockTag }),
      ),
    );
    check(latest === pending, "SIGNER_HAS_PENDING_TRANSACTION");
    return latest;
  };
  const verify = async (a, op) => {
    check(
      op.dataHash === a.dataHash &&
        same(op.from, account.address) &&
        op.to === null,
      "JOURNAL_TRANSACTION_INPUT_CHANGED",
    );
    const receipt = await client.waitForTransactionReceipt({
      hash: op.hash,
      confirmations,
      timeout,
      retryCount: 0,
    });
    const [tx, block, head, code] = await Promise.all([
      client.getTransaction({ hash: receipt.transactionHash }),
      client.getBlock({ blockNumber: receipt.blockNumber }),
      client.getBlockNumber(),
      client.getCode({ address: op.address, blockNumber: receipt.blockNumber }),
    ]);
    check(
      same(tx.from, account.address) &&
        tx.to === null &&
        tx.value === 0n &&
        tx.nonce === op.nonce &&
        v.keccak256(tx.input) === a.dataHash,
      "RECEIPT_TRANSACTION_MISMATCH",
    );
    check(
      receipt.status === "success",
      "DEPLOYMENT_TRANSACTION_REVERTED_RECONCILIATION_REQUIRED",
    );
    check(
      same(receipt.contractAddress, op.address) &&
        same(
          op.address,
          v.getContractAddress({
            from: account.address,
            nonce: BigInt(op.nonce),
          }),
        ),
      "DEPLOYED_ADDRESS_MISMATCH",
    );
    check(
      code &&
        normalizeRuntime(code, a.immutableReferences) ===
          normalizeRuntime(a.runtime, a.immutableReferences),
      "COMPILED_RUNTIME_MISMATCH",
    );
    if (a.name === "LeveraVault") {
      const [asset, decimals] = await Promise.all(
        ["asset", "decimals"].map((functionName) =>
          client.readContract({
            address: op.address,
            abi: a.abi,
            functionName,
            blockNumber: receipt.blockNumber,
          }),
        ),
      );
      check(
        same(asset, env.MAINNET_VAULT_ASSET_ADDRESS) &&
          String(decimals) === env.MAINNET_VAULT_ASSET_DECIMALS,
        "VAULT_IMMUTABLE_IDENTITY_MISMATCH",
      );
    }
    op.gasSettlement = receiptGasSettlement(
      op,
      receipt,
      block.hash,
      head,
      confirmations,
    );
    op.receipt = receipt;
    op.runtimeCodeHash = v.keccak256(code);
    persist();
  };
  stage = "chain-and-journal";
  await assertChain();
  await verifyAsset();
  for (const a of artifacts)
    if (state.operations[a.name]) await verify(a, state.operations[a.name]);

  if (mode === "--plan") {
    stage = "estimate-core-deployments";
    const [startNonce, balance, fees] = await Promise.all([
      nonce(),
      client.getBalance({ address: account.address }),
      client.estimateFeesPerGas({ type: "eip1559" }),
    ]);
    const remaining = artifacts.filter((a) => !state.operations[a.name]);
    const transactions = [];
    for (const [index, a] of remaining.entries()) {
      const gas = await client.estimateGas({
        account: account.address,
        data: a.data,
        value: 0n,
      });
      // This is a visible proposal for approval, not an execution fallback.
      const proposedGas = (gas * 12000n + 9999n) / 10000n;
      transactions.push({
        contract: a.name,
        nonce: startNonce + index,
        predictedAddress: v.getContractAddress({
          from: account.address,
          nonce: BigInt(startNonce + index),
        }),
        dataHash: a.dataHash,
        runtimeCodeHash: v.keccak256(a.runtime),
        estimatedGas: gas,
        proposedGas,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        estimatedFeeWei: gas * fees.maxFeePerGas,
        proposedReservationWei: proposedGas * fees.maxFeePerGas,
      });
    }
    const report = {
      capturedAt: new Date().toISOString(),
      chainId: chain.id,
      scope: "CORE_ONLY",
      deployer: account.address,
      owner,
      balanceWei: balance,
      completedContracts: Object.keys(state.operations),
      transactions,
      estimatedFeeWei: transactions.reduce((n, t) => n + t.estimatedFeeWei, 0n),
      proposedReservationWei: transactions.reduce(
        (n, t) => n + t.proposedReservationWei,
        0n,
      ),
      proposedGasBufferBps: 12000,
      readyToBroadcast: false,
      transactionsSubmitted: 0,
    };
    save(`${directory}/plan.json`, report);
    console.log(json(report));
  } else {
    if (mode === "--deploy") {
      check(
        env.MAINNET_CORE_BROADCAST_ENABLED === "true",
        "MAINNET_BROADCAST_NOT_AUTHORIZED",
      );
      const perTx = positive(env, "MAINNET_MAX_TRANSACTION_GAS_WEI");
      const total = positive(env, "MAINNET_MAX_TOTAL_GAS_WEI");
      const feeCap = positive(env, "MAINNET_MAX_FEE_PER_GAS_WEI");
      const reserve = positive(env, "MAINNET_MINIMUM_GAS_RESERVE_WEI");
      const buffer = positive(env, "MAINNET_GAS_LIMIT_BUFFER_BPS");
      check(buffer >= 10000n && buffer <= 20000n, "INVALID_GAS_BUFFER");
      check(total >= perTx, "INVALID_TOTAL_FEE_CAP");
      const wallet = v.createWalletClient({ account, chain, transport });
      const plan = JSON.parse(readFileSync(`${directory}/plan.json`, "utf8"));
      check(
        plan.chainId === chain.id &&
          same(plan.deployer, account.address) &&
          same(plan.owner, owner),
        "PLAN_IDENTITY_CHANGED",
      );
      for (const a of artifacts) {
        if (state.operations[a.name]) continue;
        stage = `deploy-${a.name}`;
        await assertChain();
        if (a.name === "LeveraVault") await verifyAsset();
        const nextNonce = await nonce();
        const address = v.getContractAddress({
          from: account.address,
          nonce: BigInt(nextNonce),
        });
        const approved = plan.transactions.find((t) => t.contract === a.name);
        check(
          approved &&
            approved.dataHash === a.dataHash &&
            approved.runtimeCodeHash === v.keccak256(a.runtime) &&
            approved.nonce === nextNonce &&
            same(approved.predictedAddress, address),
          "PLAN_CHANGED_REPLAN_REQUIRED",
        );
        const existingCode = await client.getCode({ address });
        check(
          !existingCode || existingCode === "0x",
          "PREDICTED_ADDRESS_ALREADY_HAS_CODE",
        );
        const gas =
          ((await client.estimateGas({
            account: account.address,
            data: a.data,
            value: 0n,
          })) *
            buffer +
            9999n) /
          10000n;
        const fees = await client.estimateFeesPerGas({ type: "eip1559" });
        check(fees.maxFeePerGas <= feeCap, "FEE_PER_GAS_LIMIT_EXCEEDED");
        const cost = gas * fees.maxFeePerGas;
        const previous = Object.values(state.operations).reduce(
          (n, op) => n + chargedGasCost(op),
          0n,
        );
        check(
          cost <= perTx && previous + cost <= total,
          "MAINNET_GAS_BUDGET_EXCEEDED",
        );
        check(
          (await client.getBalance({ address: account.address })) >=
            cost + reserve,
          "MAINNET_GAS_RESERVE_REQUIRED",
        );
        const request = {
          chain,
          account,
          type: "eip1559",
          data: a.data,
          value: 0n,
          nonce: nextNonce,
          gas,
          ...fees,
        };
        const signed = await wallet.signTransaction(request);
        const hash = v.keccak256(signed);
        state.operations[a.name] = {
          from: account.address,
          to: null,
          nonce: nextNonce,
          address,
          dataHash: a.dataHash,
          hash,
          reservedGasCostWei: String(cost),
          createdAt: new Date().toISOString(),
        };
        persist();
        writeFileSync(`${directory}/${hash}.raw`, signed, {
          mode: 0o600,
          flag: "wx",
        });
        console.log(json({ stage: "submitting", contract: a.name, hash }));
        check(
          (await client.sendRawTransaction({
            serializedTransaction: signed,
            retryCount: 0,
          })) === hash,
          "BROADCAST_HASH_MISMATCH",
        );
        await verify(a, state.operations[a.name]);
        console.log(
          json({ stage: "confirmed", contract: a.name, hash, address }),
        );
      }
    }
    stage = "verify-core-initial-state";
    check(
      artifacts.every((a) => state.operations[a.name]),
      "CORE_DEPLOYMENT_INCOMPLETE",
    );
    const read = (index, functionName, args = []) =>
      client.readContract({
        address: state.operations[artifacts[index].name].address,
        abi: artifacts[index].abi,
        functionName,
        args,
      });
    check(same(await read(0, "owner"), owner), "REGISTRY_OWNER_MISMATCH");
    check(
      (await read(0, "getMarketCount")) === 0n,
      "REGISTRY_MUST_HAVE_NO_MARKETS",
    );
    for (const a of artifacts)
      check(
        (await read(0, "isAuthorizedRouter", [
          state.operations[a.name].address,
        ])) === false,
        "ROUTER_MUST_NOT_BE_AUTHORIZED",
      );
    check(same(await read(2, "owner"), owner), "AUTO_PROTECT_OWNER_MISMATCH");
    check(
      (await read(2, "isPaused")) === true,
      "AUTO_PROTECT_MUST_STAY_PAUSED",
    );
    check(
      (await read(2, "isKeeper", [owner])) === true,
      "AUTO_PROTECT_INITIAL_KEEPER_MISMATCH",
    );
    check(
      same(await read(3, "owner"), owner) &&
        (await read(3, "isPaused")) === true,
      "SHORT_ROUTER_INITIAL_STATE_MISMATCH",
    );
    check(
      same(await read(4, "owner"), owner) &&
        same(await read(4, "asset"), env.MAINNET_VAULT_ASSET_ADDRESS),
      "VAULT_OWNER_OR_ASSET_MISMATCH",
    );
    check(
      (await read(4, "depositsPaused")) === true,
      "VAULT_DEPOSITS_MUST_STAY_PAUSED",
    );
    for (const name of ["totalSupply", "totalAssets", "getAllocationsCount"])
      check((await read(4, name)) === 0n, "VAULT_MUST_START_EMPTY");
    for (const name of ["maxDeposit", "maxMint"])
      check(
        (await read(4, name, [owner])) === 0n,
        "VAULT_ENTRY_MUST_STAY_DISABLED",
      );
    for (const [method, key] of [
      ["name", "MAINNET_VAULT_NAME"],
      ["symbol", "MAINNET_VAULT_SYMBOL"],
      ["vaultSlug", "MAINNET_VAULT_SLUG"],
      ["riskTier", "MAINNET_VAULT_RISK_TIER"],
    ])
      check((await read(4, method)) === env[key], "VAULT_METADATA_MISMATCH");
    state.complete = true;
    state.verifiedAt = new Date().toISOString();
    persist();
    let content = readFileSync(profile, "utf8");
    for (const [name, key] of specs) {
      check(
        new RegExp(`^${key}=.*$`, "m").test(content),
        "OUTPUT_ENV_FIELD_MISSING",
      );
      content = content.replace(
        new RegExp(`^${key}=.*$`, "m"),
        () => `${key}='${state.operations[name].address}'`,
      );
    }
    writeFileSync(`${profile}.tmp`, content, { mode: 0o600, flag: "wx" });
    renameSync(`${profile}.tmp`, profile);
    console.log(
      json({
        status: "CORE_DEPLOYED_VERIFIED",
        chainId: chain.id,
        marketCount: 0,
        autoProtectPaused: true,
        shortRouterPaused: true,
        vaultDepositsPaused: true,
        vaultAsset: env.MAINNET_VAULT_ASSET_ADDRESS,
        contracts: specs.map(([name]) => ({
          name,
          address: state.operations[name].address,
          hash: state.operations[name].hash,
          runtimeCodeHash: state.operations[name].runtimeCodeHash,
        })),
        totalFeeWei: Object.values(state.operations).reduce(
          (n, op) => n + chargedGasCost(op),
          0n,
        ),
        testnetConfigurationChanged: false,
      }),
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  console.error(
    json({
      stage,
      code: /^[A-Z][A-Z0-9_]+$/.test(message)
        ? message
        : "MAINNET_CORE_OPERATION_FAILED_DETAILS_REDACTED",
    }),
  );
  process.exitCode = 1;
} finally {
  release?.();
}
