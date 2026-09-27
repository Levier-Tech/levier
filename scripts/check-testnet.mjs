import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseEnv } from "node:util";
import environment from "../apps/web/config/environment.cjs";
const [path, output] = process.argv.slice(2);
try {
  if (!path || !output)
    throw new Error("Explicit ENV and evidence path required");
  const raw = parseEnv(readFileSync(path, "utf8"));
  const config = environment.validate(environment.clientSchema, raw);
  const server = environment.validate(environment.serverSchema, raw);
  let sequence = 0;
  async function rpc(method, params) {
    const response = await fetch(server.RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method, params }),
      signal: AbortSignal.timeout(server.RPC_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error("RPC unavailable");
    const body = await response.json();
    if (body.error) throw new Error("RPC failed");
    return body.result;
  }
  const chain = Number(BigInt(await rpc("eth_chainId", [])));
  if (chain !== config.CHAIN_ID) throw new Error("RPC network mismatch");
  const block = await rpc("eth_blockNumber", []);
  const addresses = config.PROTOCOL_ADDRESSES;
  const checks = [];
  for (const [name, address] of Object.entries(addresses)
    .filter(([, value]) => typeof value === "string")
    .concat(
      Object.entries(addresses.pairs).map(([key, value]) => [
        `pair:${key}`,
        value,
      ]),
    )) {
    const bytecode = await rpc("eth_getCode", [address, block]);
    checks.push({
      name,
      bytecodePresent: typeof bytecode === "string" && bytecode !== "0x",
    });
  }
  const historical = JSON.parse(
    readFileSync("packages/contracts/deployments/testnet.json", "utf8"),
  );
  const evidence = {
    capturedAt: new Date().toISOString(),
    network: config.NETWORK_MODE,
    chainId: chain,
    observedBlock: BigInt(block).toString(),
    historicalManifestChainId: historical.chainId,
    historicalManifestMatches: historical.chainId === chain,
    executionEnabled: config.TRADING_ENABLED,
    contracts: checks,
    testnetReady: false,
    limitations: [
      "Bytecode presence alone does not prove contract identity or correct configuration",
      "Historical manifest is a local deployment; canonical indexing and live lifecycle acceptance remain required",
    ],
    transactionsSubmitted: 0,
  };
  mkdirSync(output, { recursive: true });
  writeFileSync(
    `${output}/chain-readiness.json`,
    JSON.stringify(evidence, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(
    `Testnet read audit complete: chain ${chain}, ${checks.filter((item) => item.bytecodePresent).length}/${checks.length} configured contracts have code; ready=false`,
  );
} catch {
  console.error(
    "Testnet read audit could not complete; sensitive provider details redacted",
  );
  process.exitCode = 1;
}
