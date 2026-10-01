import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";

// Publishes the Solidity source of every Levier contract from the mainnet deployment record
// (packages/contracts/deployments/mainnet-4663.json) to the Robinhood Chain explorer.
// Constructor arguments are recovered from each deployment transaction's input on-chain.
// The vendored Uniswap V2 factory/pools (solc 0.5.16 build artifacts) are not verified here.
//
// Usage: ETHERSCAN_API_KEY=... node scripts/verify-rh-mainnet-sources.mjs [--verifier etherscan|blockscout]
const require = createRequire(
  new URL("../apps/keeper/package.json", import.meta.url),
);
const v = require("viem");

const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
const CHAIN_ID = 4663;
const record = JSON.parse(
  readFileSync("packages/contracts/deployments/mainnet-4663.json", "utf8"),
);
const verifierArg = process.argv.indexOf("--verifier");
const verifier = verifierArg > 0 ? process.argv[verifierArg + 1] : "etherscan";
if (!["etherscan", "blockscout"].includes(verifier))
  throw Error("VERIFIER_MUST_BE_ETHERSCAN_OR_BLOCKSCOUT");
// The API key comes from the environment or from the gitignored mainnet profile.
const profileKey = (() => {
  try {
    return parseEnv(readFileSync(".env.mainnet.core.local", "utf8"))
      .ETHERSCAN_API_KEY;
  } catch {
    return undefined;
  }
})();
const apiKey = process.env.ETHERSCAN_API_KEY || profileKey;
if (verifier === "etherscan" && !apiKey)
  throw Error("ETHERSCAN_API_KEY_REQUIRED");

const sources = {
  registry: "src/registry/LevierMarketRegistry.sol:LevierMarketRegistry",
  lendingRouter: "src/routers/LevierRouter.sol:LevierRouter",
  autoProtect: "src/modules/AutoProtectModule.sol:AutoProtectModule",
  shortRouter: "src/routers/ShortRouter.sol:ShortRouter",
  vault: "src/vaults/LevierVault.sol:LevierVault",
  leverageRouter: "src/routers/LeverageRouter.sol:LeverageRouter",
  oracle: "src/oracle/VerifiedFeedOracle.sol:VerifiedFeedOracle",
};
for (const role of Object.keys(record.addresses))
  if (/^(long|short)-/.test(role))
    sources[role] = "src/core/LevierPair.sol:LevierPair";
  else if (role.startsWith("margin-"))
    sources[role] = "src/trading/MarginRouter.sol:MarginRouter";

const client = v.createPublicClient({ transport: v.http(RPC_URL) });
const results = [];
for (const [role, target] of Object.entries(sources)) {
  const address = record.addresses[role];
  const hash = record.transactions[`deploy-${role}`];
  const name = target.split(":")[1];
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
    "--watch",
  ];
  if (args !== "0x") command.push("--constructor-args", args);
  if (verifier === "blockscout")
    command.push(
      "--verifier-url",
      "https://robinhoodchain.blockscout.com/api/",
    );
  else
    command.push(
      "--verifier-url",
      `https://api.etherscan.io/v2/api?chainid=${CHAIN_ID}`,
      "--etherscan-api-key",
      apiKey,
    );
  console.log(`== ${role} ${address}`);
  try {
    const out = execFileSync("forge", command, {
      cwd: "packages/contracts",
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const verified = /verified|Pass - Verified|already verified/i.test(out);
    results.push({ role, address, status: verified ? "verified" : "submitted" });
    console.log(out.trim().split("\n").slice(-2).join("\n"));
  } catch (error) {
    const text = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    const already = /already verified/i.test(text);
    results.push({ role, address, status: already ? "verified" : "failed" });
    console.log(
      /Just a moment|challenges\.cloudflare\.com/.test(text)
        ? "EXPLORER_API_BLOCKED_BY_CLOUDFLARE"
        : text.trim().split("\n").slice(-3).join("\n").slice(0, 600),
    );
  }
}
console.log(JSON.stringify(results, null, 2));
if (results.some((r) => r.status === "failed")) process.exitCode = 1;
