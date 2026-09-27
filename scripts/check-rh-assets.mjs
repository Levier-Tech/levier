import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const requireKeeper = createRequire(
  new URL("../apps/keeper/package.json", import.meta.url),
);
const { createPublicClient, http, erc20Abi, parseAbi, formatUnits } =
  requireKeeper("viem");
const [profile, outputDirectory] = process.argv.slice(2);
try {
  if (!profile || !outputDirectory) throw Error();
  const env = parseEnv(readFileSync(profile, "utf8"));
  if (
    env.NETWORK_MODE !== "TESTNET" ||
    env.CHAIN_ID !== "46630" ||
    env.TRADING_ENABLED !== "false"
  )
    throw Error();
  const addresses = JSON.parse(env.PROTOCOL_ADDRESSES);
  const timeout = Number(env.RPC_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw Error();
  const client = createPublicClient({
    transport: http(env.RPC_URL, { retryCount: 0, timeout }),
  });
  if ((await client.getChainId()) !== Number(env.CHAIN_ID)) throw Error();
  const blockNumber = await client.getBlockNumber();
  const tokens = [];
  const oracleAbi = parseAbi([
    "function getPrice(address) view returns (uint256)",
  ]);
  for (const [configuredSymbol, address] of Object.entries(addresses.tokens)) {
    const row = {
      configuredSymbol,
      bytecodePresent: false,
      symbolMatches: false,
      oracleReadable: false,
    };
    const code = await client.getCode({ address, blockNumber });
    row.bytecodePresent = !!code && code !== "0x";
    if (row.bytecodePresent) {
      try {
        const actualSymbol = await client.readContract({
          address,
          abi: erc20Abi,
          functionName: "symbol",
          blockNumber,
        });
        if (!/^[A-Za-z0-9._-]{1,24}$/.test(actualSymbol)) throw Error();
        const decimals = await client.readContract({
          address,
          abi: erc20Abi,
          functionName: "decimals",
          blockNumber,
        });
        row.actualSymbol = actualSymbol;
        row.decimals = decimals;
        row.symbolMatches = actualSymbol === configuredSymbol;
        row.deployerBalance = formatUnits(
          await client.readContract({
            address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [env.DEPLOYER_ADDRESS],
            blockNumber,
          }),
          decimals,
        );
        row.testerBalance = formatUnits(
          await client.readContract({
            address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [env.TESTER_ADDRESS],
            blockNumber,
          }),
          decimals,
        );
      } catch {
        row.metadataReadable = false;
      }
      try {
        row.oracleReadable =
          (await client.readContract({
            address: addresses.oracle,
            abi: oracleAbi,
            functionName: "getPrice",
            args: [address],
            blockNumber,
          })) > 0n;
      } catch {
        row.oracleReadable = false;
      }
    }
    tokens.push(row);
  }
  const report = {
    capturedAt: new Date().toISOString(),
    chainId: Number(env.CHAIN_ID),
    block: blockNumber.toString(),
    tokens,
    configuredAssetsPassReadChecks:
      tokens.length > 0 &&
      tokens.every(
        (row) =>
          row.bytecodePresent &&
          row.symbolMatches &&
          row.oracleReadable &&
          row.metadataReadable !== false,
      ),
    testnetReady: false,
    transactionsSubmitted: 0,
    limitations: [
      "Matching symbols are not proof of official issuance",
      "Oracle provenance, freshness policy, swap liquidity and deployment identity still require validation",
    ],
  };
  const output = JSON.stringify(report, null, 2) + "\n";
  for (const [key, value] of Object.entries(env))
    if (
      /PRIVATE_KEY|DATABASE_URL|SUPABASE|RPC_URL/.test(key) &&
      value.length > 12 &&
      output.includes(value)
    )
      throw Error();
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(resolve(outputDirectory, "assets.json"), output, {
    flag: "wx",
  });
  console.log(output);
  if (!report.configuredAssetsPassReadChecks) process.exitCode = 1;
} catch {
  console.error(
    "Asset verification unavailable; inspect explicit TESTNET profile and output path locally. Values redacted.",
  );
  process.exitCode = 1;
}
