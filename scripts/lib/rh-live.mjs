import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  statSync,
  existsSync,
} from "node:fs";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import {
  chargedGasCost,
  settleOperationGas,
  verifyGasLedgerAnchor,
} from "./rh-gas-ledger.mjs";
const requireKeeper = createRequire(
  new URL("../../apps/keeper/package.json", import.meta.url),
);
export const v = requireKeeper("viem");
const { privateKeyToAccount } = requireKeeper("viem/accounts");
export const json = (value) =>
  JSON.stringify(value, (_, x) => (typeof x === "bigint" ? String(x) : x), 2);
export const assert = (condition, code) => {
  if (!condition) throw new Error(code);
};
export const same = (a, b) =>
  String(a).toLowerCase() === String(b).toLowerCase();
export function save(path, value) {
  writeFileSync(`${path}.tmp`, json(value) + "\n", { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}
export function updateEnv(path, updates) {
  let content = readFileSync(path, "utf8");
  for (const [key, value] of Object.entries(updates)) {
    assert(
      /^[A-Z][A-Z0-9_]*$/.test(key) &&
        !String(value).includes("'") &&
        !String(value).includes("\n"),
      "INVALID_ENV_UPDATE",
    );
    const line = `${key}='${value}'`;
    const re = new RegExp(`^${key}=.*$`, "m");
    content = re.test(content)
      ? content.replace(re, () => line)
      : `${content.trimEnd()}\n${line}\n`;
  }
  writeFileSync(`${path}.tmp`, content, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}
export async function context(profile) {
  assert(
    profile === ".env.testnet" || profile === "--runtime",
    "EXPLICIT_TESTNET_PROFILE_REQUIRED",
  );
  const runtime = profile === "--runtime";
  if (!runtime) {
    execFileSync("git", ["check-ignore", "-q", profile]);
    assert(
      !execFileSync("git", ["ls-files", "--", profile], {
        encoding: "utf8",
      }).trim(),
      "ENV_MUST_NOT_BE_TRACKED",
    );
    assert((statSync(profile).mode & 0o077) === 0, "ENV_PERMISSIONS_REQUIRED");
  }
  const env = runtime
    ? { ...process.env }
    : parseEnv(readFileSync(profile, "utf8"));
  // Hosting must mount the existing private journal. Never bootstrap a new
  // signer ledger on an ephemeral container or silently reset its gas history.
  if (runtime) {
    assert(
      existsSync(".secrets/rh-live/state.json"),
      "PERSISTENT_JOURNAL_REQUIRED",
    );
    assert(
      (statSync(".secrets/rh-live/state.json").mode & 0o077) === 0,
      "JOURNAL_PERMISSIONS_REQUIRED",
    );
  }
  assert(
    env.NETWORK_MODE === "TESTNET" &&
      env.CHAIN_ID === "46630" &&
      env.TRADING_ENABLED === "false",
    "TESTNET_ONLY",
  );
  const timeout = Number(env.RPC_TIMEOUT_MS);
  assert(Number.isSafeInteger(timeout) && timeout > 0, "RPC_POLICY_REQUIRED");
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
  const httpTransport = v.http(env.RPC_URL, { timeout, retryCount: 0 });
  // The RPC endpoint sits behind several nodes. A node that is a block behind rejects reads pinned to the
  // newest block ("unsupported block number"), so retry only those rejections; sends are never retried.
  const behindNode = /unsupported block number|header not found|block not found|unknown block/i;
  const transport = (options) => {
    const inner = httpTransport(options);
    return {
      ...inner,
      request: async (args) => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await inner.request(args);
          } catch (error) {
            const detail = String(error?.details ?? error?.shortMessage ?? error?.message);
            if (attempt >= 5 || !behindNode.test(detail)) throw error;
            await new Promise((resolve) => setTimeout(resolve, 1200));
          }
        }
      },
    };
  };
  const client = v.createPublicClient({ chain, transport, cacheTime: 0 });
  assert((await client.getChainId()) === 46630, "RPC_CHAIN_MISMATCH");
  const deployer = privateKeyToAccount(env.PRIVATE_KEY),
    publisher = privateKeyToAccount(env.KEEPER_PRIVATE_KEY);
  assert(
    same(deployer.address, env.DEPLOYER_ADDRESS) &&
      same(publisher.address, env.KEEPER_ADDRESS),
    "SIGNER_IDENTITY_MISMATCH",
  );
  const directory = ".secrets/rh-live";
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!runtime)
    execFileSync("git", ["check-ignore", "-q", `${directory}/state.json`]);
  const statePath = `${directory}/state.json`;
  const state = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf8"))
    : { chainId: 46630, operations: {} };
  assert(state.chainId === 46630, "STATE_CHAIN_MISMATCH");
  const persist = () => save(statePath, state);
  return {
    env,
    chain,
    client,
    deployer,
    publisher,
    directory,
    state,
    persist,
    wallet: (account) => v.createWalletClient({ account, chain, transport }),
  };
}
export function artifact(name) {
  const result = JSON.parse(
    readFileSync(`packages/contracts/out/${name}.sol/${name}.json`, "utf8"),
  );
  return { abi: result.abi, bytecode: result.bytecode.object };
}
export async function verifyRuntime(client, address, name) {
  const compiled = JSON.parse(
    readFileSync(`packages/contracts/out/${name}.sol/${name}.json`, "utf8"),
  ).deployedBytecode;
  const actual = await client.getCode({ address });
  assert(actual && actual !== "0x", "DEPLOYMENT_CODE_MISSING");
  const normalize = (code) => {
    let hex = code.slice(2).toLowerCase();
    for (const references of Object.values(compiled.immutableReferences ?? {}))
      for (const { start, length } of references)
        hex =
          hex.slice(0, start * 2) +
          "0".repeat(length * 2) +
          hex.slice((start + length) * 2);
    return hex;
  };
  assert(
    normalize(actual) === normalize(compiled.object),
    "COMPILED_RUNTIME_MISMATCH",
  );
  return v.keccak256(actual);
}
const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const beaconSlot =
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
export async function fingerprint(client, address, atBlock) {
  const blockNumber = atBlock ?? (await client.getBlockNumber());
  const code = await client.getCode({ address, blockNumber });
  assert(code && code !== "0x", "TOKEN_CODE_MISSING");
  const result = {
    address,
    codeHash: v.keccak256(code),
    implementation: null,
    beacon: null,
  };
  for (const [role, slot] of [
    ["implementation", implementationSlot],
    ["beacon", beaconSlot],
  ]) {
    const storage = await client.getStorageAt({ address, slot, blockNumber });
    if (storage && BigInt(storage) !== 0n) {
      const target = v.getAddress(`0x${storage.slice(-40)}`);
      const targetCode = await client.getCode({ address: target, blockNumber });
      assert(targetCode && targetCode !== "0x", "PROXY_TARGET_MISSING");
      result[role] = { address: target, codeHash: v.keccak256(targetCode) };
      if (role === "beacon") {
        const implementation = await client.readContract({
          address: target,
          abi: v.parseAbi(["function implementation() view returns(address)"]),
          functionName: "implementation",
          blockNumber,
        });
        const implementationCode = await client.getCode({
          address: implementation,
          blockNumber,
        });
        assert(
          implementationCode && implementationCode !== "0x",
          "PROXY_IMPLEMENTATION_MISSING",
        );
        result.beacon.implementation = {
          address: implementation,
          codeHash: v.keccak256(implementationCode),
        };
      }
    }
  }
  return result;
}
export async function verifyBinding(ctx, binding) {
  const { client, env } = ctx;
  assert(
    binding.mode === "RH_TESTNET_REAL_REFERENCE" && binding.chainId === 46630,
    "INVALID_BINDING",
  );
  const tokens = JSON.parse(env.PROTOCOL_ADDRESSES).tokens;
  assert(
    typeof binding.stockSymbol === "string" &&
      /^[A-Z][A-Z0-9]{0,15}$/.test(binding.stockSymbol) &&
      typeof tokens[binding.stockSymbol] === "string" &&
      same(binding.collateral, tokens[binding.stockSymbol]) &&
      same(binding.debt, env.USDG_ISSUER_TESTNET_ADDRESS) &&
      same(binding.debt, tokens.USDG),
    "BINDING_ASSET_MISMATCH",
  );
  for (const role of ["collateral", "debt"])
    assert(
      json(await fingerprint(client, binding[role])) ===
        json(binding.tokenFingerprints[role]),
      "TOKEN_IMPLEMENTATION_CHANGED",
    );
  const metadata = v.parseAbi([
    "function uid() view returns(bytes32)",
    "function uiMultiplier() view returns(uint256)",
  ]);
  assert(
    same(
      await client.readContract({
        address: binding.collateral,
        abi: metadata,
        functionName: "uid",
      }),
      binding.testnetStockUid,
    ),
    "TESTNET_UID_CHANGED",
  );
  assert(
    String(
      await client.readContract({
        address: binding.collateral,
        abi: metadata,
        functionName: "uiMultiplier",
      }),
    ) === binding.multiplier18,
    "TESTNET_MULTIPLIER_CHANGED",
  );
}
export async function submit(ctx, id, account, request) {
  assert(
    ctx.env.RH_TESTNET_DEPLOYMENT_APPROVED === "true",
    "TESTNET_DEPLOYMENT_APPROVAL_REQUIRED",
  );
  assert((await ctx.client.getChainId()) === 46630, "RPC_CHAIN_MISMATCH");
  const policy = JSON.parse(ctx.env.RH_LIVE_EXECUTION_JSON);
  const old = ctx.state.operations[id];
  if (old) {
    assert(
      same(old.from, account.address) &&
        same(old.to ?? "", request.to ?? "") &&
        old.dataHash === v.keccak256(request.data),
      "OPERATION_INPUT_CHANGED",
    );
    const receipt = await ctx.client.waitForTransactionReceipt({
      hash: old.hash,
      confirmations: policy.confirmations,
      timeout: policy.receiptTimeoutMs,
    });
    assert(receipt.status === "success", "PREVIOUS_TRANSACTION_REVERTED");
    assert(
      (await ctx.client.getBlock({ blockNumber: receipt.blockNumber })).hash ===
        receipt.blockHash,
      "RECEIPT_REORG",
    );
    old.receipt = receipt;
    await settleOperationGas(ctx, old, receipt, policy.confirmations);
    ctx.persist();
    return receipt;
  }
  // Check nonce ambiguity before signing; no automatic replacements or retries.
  const pending = await ctx.client.getTransactionCount({
    address: account.address,
    blockTag: "pending",
  });
  const confirmed = await ctx.client.getTransactionCount({
    address: account.address,
    blockTag: "latest",
  });
  assert(pending === confirmed, "SIGNER_HAS_PENDING_TRANSACTION");
  await ctx.client.call({ ...request, account: account.address });
  const wallet = ctx.wallet(account);
  const prepared = await wallet.prepareTransactionRequest({
    ...request,
    account,
    nonce: pending,
    chain: ctx.chain,
    value: 0n,
  });
  const cost = prepared.gas * (prepared.maxFeePerGas ?? prepared.gasPrice);
  assert(
    cost <= BigInt(policy.maxTransactionGasCostWei),
    "TRANSACTION_GAS_BUDGET_EXCEEDED",
  );
  await verifyGasLedgerAnchor(ctx);
  const previous = Object.values(ctx.state.operations)
    .filter((op) => same(op.from, account.address))
    .reduce((sum, op) => sum + chargedGasCost(op), 0n);
  assert(
    previous + cost <= BigInt(policy.maxSignerGasCostWei),
    "SIGNER_GAS_BUDGET_EXCEEDED",
  );
  assert(
    (await ctx.client.getBalance({ address: account.address })) >
      cost + BigInt(policy.minimumGasReserveWei),
    "GAS_RESERVE_REQUIRED",
  );
  const signed = await wallet.signTransaction(prepared);
  const hash = v.keccak256(signed);
  ctx.state.operations[id] = {
    from: account.address,
    to: request.to ?? null,
    dataHash: v.keccak256(request.data),
    hash,
    reservedGasCostWei: String(cost),
    nonce: pending,
    createdAt: new Date().toISOString(),
  };
  ctx.persist();
  // Restricted raw transaction permits reconciling an uncertain send without signing a duplicate.
  writeFileSync(`${ctx.directory}/${hash}.raw`, signed, {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify({ stage: "submitting", operation: id, hash }));
  assert(
    (await ctx.client.sendRawTransaction({ serializedTransaction: signed })) ===
      hash,
    "BROADCAST_HASH_MISMATCH",
  );
  const receipt = await ctx.client.waitForTransactionReceipt({
    hash,
    confirmations: policy.confirmations,
    timeout: policy.receiptTimeoutMs,
  });
  ctx.state.operations[id].receipt = receipt;
  ctx.persist();
  assert(receipt.status === "success", "TRANSACTION_REVERTED");
  assert(
    (await ctx.client.getBlock({ blockNumber: receipt.blockNumber })).hash ===
      receipt.blockHash,
    "RECEIPT_REORG",
  );
  await settleOperationGas(
    ctx,
    ctx.state.operations[id],
    receipt,
    policy.confirmations,
  );
  ctx.persist();
  console.log(
    JSON.stringify({
      stage: "confirmed",
      operation: id,
      hash,
      block: String(receipt.blockNumber),
    }),
  );
  return receipt;
}
export function safeFailure(error) {
  // Provider errors may contain credentials or raw signed requests: never emit them.
  const message =
    typeof error?.message === "string" &&
    /^[A-Z][A-Z0-9_]{2,90}$/.test(error.message)
      ? error.message
      : "LIVE_OPERATION_FAILED_DETAILS_REDACTED";
  console.error(message);
  process.exitCode = 1;
}
