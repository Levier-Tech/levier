import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";

const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createPublicClient, http } = requireWeb("viem");

const env = parseEnv(readFileSync(new URL("../apps/web/.env", import.meta.url), "utf8"));

let rpcUrl = env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
if (rpcUrl.includes("robinhood-testnet.g.alchemy.com")) {
  rpcUrl = rpcUrl.replace("robinhood-testnet.g.alchemy.com", "robinhood-mainnet.g.alchemy.com");
}

console.log("Testing RPC URL:", rpcUrl.replace(/alch_[a-zA-Z0-9_-]+/, "alch_***"));

const client = createPublicClient({
  transport: http(rpcUrl),
});

async function checkMainnet() {
  try {
    const chainId = await client.getChainId();
    console.log("Connected to Chain ID:", chainId);
    if (chainId === 4663) {
      console.log("SUCCESS! Confirmed Mainnet connection.");
    } else {
      console.error("WARNING: Expected Chain ID 4663, but got", chainId);
    }
  } catch (err) {
    console.error("Failed to connect:", err.message);
  }
}

checkMainnet();
