import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";

// Publishes the Solidity source of every Levier contract from the mainnet deployment record
// (packages/contracts/deployments/mainnet-4663.json). Constructor arguments are recovered
// from each deployment transaction's input on-chain. The vendored Uniswap V2 factory and
// pools are standard bytecode that the explorers already match, so they are only reported.
//
// Usage: node scripts/verify-rh-mainnet-sources.mjs [--verifier sourcify|etherscan]
//   sourcify  (default) no key needed; results appear on Sourcify and Blockscout
//   etherscan needs ETHERSCAN_API_KEY (environment or .env.mainnet.core.local)
const require = createRequire(
  new URL("../apps/keeper/package.json", import.meta.url),
);
const v = require("viem");

const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
const CHAIN_ID = 4663;
const SOURCIFY = "https://sourcify.dev/server";
const record = JSON.parse(
  readFileSync("packages/contracts/deployments/mainnet-4663.json", "utf8"),
);
const verifierArg = process.argv.indexOf("--verifier");
const verifier = verifierArg > 0 ? process.argv[verifierArg + 1] : "sourcify";
if (!["sourcify", "etherscan"].includes(verifier))
  throw Error("VERIFIER_MUST_BE_SOURCIFY_OR_ETHERSCAN");

const apiKey = (() => {
  if (verifier !== "etherscan") return undefined;
  if (process.env.ETHERSCAN_API_KEY) return process.env.ETHERSCAN_API_KEY;
  try {
    return parseEnv(readFileSync(".env.mainnet.core.local", "utf8"))
      .ETHERSCAN_API_KEY;
  } catch {
    return undefined;
  }
})();
if (verifier === "etherscan" && !apiKey)
  throw Error("ETHERSCAN_API_KEY_REQUIRED");

// v2 record: implementations are "impl-<Contract>", every other Levier role is an ERC1967 proxy.
const SOURCE_PATHS = {
  LevierMarketRegistry: "src/registry/LevierMarketRegistry.sol",
  LevierRouter: "src/routers/LevierRouter.sol",
  AutoProtectModule: "src/modules/AutoProtectModule.sol",
  ShortRouter: "src/routers/ShortRouter.sol",
  LevierVault: "src/vaults/LevierVault.sol",
  LeverageRouter: "src/routers/LeverageRouter.sol",
  VerifiedFeedOracle: "src/oracle/VerifiedFeedOracle.sol",
  LevierPair: "src/core/LevierPair.sol",
  MarginRouter: "src/trading/MarginRouter.sol",
  PonsV4TwapOracle: "src/ponsperp/PonsV4TwapOracle.sol",
  PonsLiquidityVault: "src/ponsperp/PonsLiquidityVault.sol",
  PonsPerpManager: "src/ponsperp/PonsPerpManager.sol",
};
// Pons leverage lives in its own section of the record; verify it with the core contracts.
if (record.pons) {
  Object.assign(record.addresses, record.pons.addresses);
  Object.assign(record.transactions, record.pons.transactions);
}
const PROXY =
  "node_modules/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy";
const sources = {};
for (const role of Object.keys(record.addresses)) {
  if (role === "v2Factory" || role.startsWith("pool-")) continue;
  if (role.startsWith("impl-")) {
    const name = role.slice(5);
    sources[role] = `${SOURCE_PATHS[name]}:${name}`;
  } else sources[role] = PROXY;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sourcifyMatch(address) {
  const r = await fetch(`${SOURCIFY}/v2/contract/${CHAIN_ID}/${address}`);
  if (!r.ok) return null;
  return (await r.json()).match ?? null;
}
async function sourcifyJob(id) {
  for (let i = 0; i < 60; i++) {
    const job = await (await fetch(`${SOURCIFY}/v2/verify/${id}`)).json();
    if (job.isJobCompleted)
      return job.contract?.match ?? `failed: ${job.error?.message ?? "unknown"}`;
    await sleep(5000);
  }
  return "still processing (check again later)";
}

const client = v.createPublicClient({ transport: v.http(RPC_URL) });
console.log(
  `Verifying ${Object.keys(sources).length} Levier contracts on ${verifier} (Robinhood Chain ${CHAIN_ID})\n`,
);
const results = [];
for (const [role, target] of Object.entries(sources)) {
  const address = record.addresses[role];
  const hash = record.transactions[`deploy-${role}`];
  const name = target.split(":")[1];
  process.stdout.write(`${role.padEnd(15)} ${name.padEnd(21)} ${address}  `);
  try {
    if (verifier === "sourcify") {
      const existing = await sourcifyMatch(address);
      if (existing) {
        results.push({ role, address, status: existing });
        console.log(`already verified (${existing})`);
        continue;
      }
    }
    const artifact = JSON.parse(
      readFileSync(`packages/contracts/out/${name}.sol/${name}.json`, "utf8"),
    );
    const tx = await client.getTransaction({ hash });
    const receipt = await client.getTransactionReceipt({ hash });
    if (
      tx.to !== null ||
      receipt.contractAddress?.toLowerCase() !== address.toLowerCase() ||
      !tx.input.toLowerCase().startsWith(artifact.bytecode.object.toLowerCase())
    )
      throw Error(`DEPLOYMENT_INPUT_MISMATCH_${role}`);
    const args = `0x${tx.input.slice(artifact.bytecode.object.length)}`;
    const command = [
      "verify-contract",
      address,
      target,
      "--chain-id",
      String(CHAIN_ID),
      "--rpc-url",
      RPC_URL,
      "--verifier",
      verifier,
    ];
    if (args !== "0x") command.push("--constructor-args", args);
    if (verifier === "etherscan")
      command.push(
        "--verifier-url",
        `https://api.etherscan.io/v2/api?chainid=${CHAIN_ID}`,
        "--etherscan-api-key",
        apiKey,
        "--watch",
      );
    const out = execFileSync("forge", command, {
      cwd: "packages/contracts",
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let status;
    if (verifier === "sourcify") {
      const id = out.match(/Job ID: `([^`]+)`/)?.[1];
      status = id
        ? await sourcifyJob(id)
        : ((await sourcifyMatch(address)) ?? "failed: no job id and no match");
    } else status = /verified/i.test(out) ? "verified" : "submitted";
    results.push({ role, address, status });
    console.log(status);
  } catch (error) {
    const text = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`;
    const status = /already verified/i.test(text)
      ? "already verified"
      : /Just a moment|challenges\.cloudflare\.com/.test(text)
        ? "failed: explorer API blocked by Cloudflare"
        : `failed: ${text.trim().split("\n").pop().slice(0, 200)}`;
    results.push({ role, address, status });
    console.log(status);
  }
}

console.log("\nUniswap V2 (standard bytecode, matched by the explorer):");
for (const role of ["v2Factory", ...Object.keys(record.addresses).filter((r) => r.startsWith("pool-"))])
  console.log(`${role.padEnd(15)} ${record.addresses[role]}`);

const failed = results.filter((r) => /^failed|still processing/.test(r.status));
console.log(
  `\n${results.length - failed.length} of ${results.length} Levier contracts verified on ${verifier}.`,
);
if (verifier === "sourcify")
  console.log(
    `Browse: https://repo.sourcify.dev/${CHAIN_ID}/${record.addresses.registry}\n` +
      `Explorer: https://robinhoodchain.blockscout.com/address/${record.addresses.registry}?tab=contract`,
  );
if (failed.length) process.exitCode = 1;
