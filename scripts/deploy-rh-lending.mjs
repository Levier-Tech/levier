import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, join, delimiter } from "node:path";
import { homedir } from "node:os";
const root = fileURLToPath(new URL("../", import.meta.url));
const [mode, profile] = process.argv.slice(2);
try {
  if (
    !["--simulate", "--simulate-oracle"].includes(mode) ||
    !profile ||
    process.argv.length !== 4
  )
    throw Error(
      "Usage: deploy:testnet <--simulate|--simulate-oracle> <explicit RH ENV path>. Broadcasting is unavailable pending integration acceptance.",
    );
  const env = parseEnv(readFileSync(resolve(profile), "utf8"));
  if (
    env.NETWORK_MODE !== "TESTNET" ||
    env.CHAIN_ID !== "46630" ||
    env.TRADING_ENABLED !== "false"
  )
    throw Error("A TESTNET-only profile with execution disabled is required.");
  const oracleMode = mode === "--simulate-oracle";
  if (oracleMode) {
    if (!env.RH_ORACLE_CONFIG_JSON)
      throw Error(
        "RH_ORACLE_CONFIG_JSON is not prepared: verified asset feeds, sequencer and policies are required.",
      );
    let descriptor;
    try {
      descriptor = JSON.parse(env.RH_ORACLE_CONFIG_JSON);
    } catch {
      throw Error("RH_ORACLE_CONFIG_JSON is invalid JSON.");
    }
    const required = {
      sequencer: ["address", "runtimeCodeHash", "description", "gracePeriod"],
      collateral: [
        "assetAddress",
        "assetRuntimeCodeHash",
        "symbol",
        "feedAddress",
        "feedRuntimeCodeHash",
        "description",
        "maxAge",
        "minPrice18",
        "maxPrice18",
        "checkTokenPause",
      ],
      debt: [
        "assetAddress",
        "assetRuntimeCodeHash",
        "symbol",
        "feedAddress",
        "feedRuntimeCodeHash",
        "description",
        "maxAge",
        "minPrice18",
        "maxPrice18",
        "checkTokenPause",
      ],
    };
    if (
      !descriptor ||
      Object.keys(descriptor).some((k) => !Object.hasOwn(required, k))
    )
      throw Error("RH_ORACLE_CONFIG_JSON has unexpected fields.");
    for (const [section, fields] of Object.entries(required)) {
      if (
        !descriptor[section] ||
        fields.some(
          (k) =>
            descriptor[section][k] === undefined ||
            descriptor[section][k] === "",
        ) ||
        Object.keys(descriptor[section]).some((k) => !fields.includes(k))
      )
        throw Error("RH_ORACLE_CONFIG_JSON has missing or unexpected fields.");
    }
  } else {
    if (!env.RH_LENDING_MARKET_JSON)
      throw Error(
        "RH_LENDING_MARKET_JSON is not prepared: verified collateral, debt, oracle and risk parameters are required.",
      );
    let market;
    try {
      market = JSON.parse(env.RH_LENDING_MARKET_JSON);
    } catch {
      throw Error("RH_LENDING_MARKET_JSON is invalid JSON.");
    }
    const fields = [
      "collateralAddress",
      "debtAddress",
      "oracleAddress",
      "oracleRuntimeCodeHash",
      "collateralSymbol",
      "debtSymbol",
      "collateralDecimals",
      "debtDecimals",
      "maxLtvBps",
      "liquidationLtvBps",
      "supplyCapRaw",
      "borrowCapRaw",
      "slug",
    ];
    if (
      fields.some((key) => market[key] === undefined || market[key] === "") ||
      Object.keys(market).some((key) => !fields.includes(key))
    )
      throw Error("RH_LENDING_MARKET_JSON has missing or unexpected fields.");
  }
  for (const key of ["PRIVATE_KEY", "DEPLOYER_ADDRESS", "RPC_URL"])
    if (!env[key]) throw Error(`Required field missing: ${key}`);
  const directory = join(
    root,
    ".secrets/deployment-simulations",
    new Date().toISOString().replaceAll(":", "-"),
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  let output;
  try {
    output = execFileSync(
      "forge",
      [
        "script",
        oracleMode
          ? "script/DeployRhOracle.s.sol:DeployRhOracle"
          : "script/DeployRhLending.s.sol:DeployRhLending",
        "--rpc-url",
        "robinhood_testnet",
      ],
      {
        cwd: join(root, "packages/contracts"),
        env: {
          ...process.env,
          ...env,
          PATH: `${join(homedir(), ".foundry/bin")}${delimiter}${process.env.PATH}`,
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 8 * 1024 * 1024,
        timeout: 120000,
      },
    );
  } catch {
    throw Error(
      "Deployment simulation did not pass. No transaction broadcast. Verify contract compilation, asset identity, oracle and risk inputs.",
    );
  }
  for (const [key, value] of Object.entries(env))
    if (
      /PRIVATE_KEY|RPC_URL|DATABASE_URL|SUPABASE/.test(key) &&
      value.length > 12
    )
      output = output.replaceAll(value, "[REDACTED]");
  writeFileSync(join(directory, "simulation.log"), output, {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    "Simulation completed without broadcasting. Results stored in ignored, access-restricted RH deployment-simulations directory. Contract identity, receipt indexing and funded lifecycle acceptance remain required.",
  );
} catch (error) {
  // Only messages generated by this wrapper are emitted; external process/provider errors are discarded.
  const safePrefixes = [
    "Usage:",
    "A TESTNET-only",
    "RH_LENDING_MARKET_JSON",
    "RH_ORACLE_CONFIG_JSON",
    "Required field missing:",
    "Deployment simulation did not pass.",
  ];
  console.error(
    safePrefixes.some((prefix) => error?.message?.startsWith(prefix))
      ? error.message
      : "Deployment preparation unavailable; values redacted.",
  );
  process.exitCode = 1;
}
