import { readFileSync, statSync } from "node:fs";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";

// Offline preparation only: deliberately no RPC client, signer, or broadcast.
const profile = ".env.mainnet.core.local";
const required = [
  "RPC_URL",
  "PRIVATE_KEY",
  "DEPLOYER_ADDRESS",
  "PROTOCOL_OWNER_ADDRESS",
  "MAINNET_MAX_TRANSACTION_GAS_WEI",
  "MAINNET_MAX_TOTAL_GAS_WEI",
  "MAINNET_MAX_FEE_PER_GAS_WEI",
  "MAINNET_MINIMUM_GAS_RESERVE_WEI",
  "MAINNET_GAS_LIMIT_BUFFER_BPS",
  "MAINNET_RECEIPT_CONFIRMATIONS",
  "MAINNET_RECEIPT_TIMEOUT_MS",
  "MAINNET_VAULT_ASSET_ADDRESS",
  "MAINNET_VAULT_ASSET_SYMBOL",
  "MAINNET_VAULT_ASSET_DECIMALS",
  "MAINNET_VAULT_ASSET_CODE_HASH",
  "MAINNET_VAULT_NAME",
  "MAINNET_VAULT_SYMBOL",
  "MAINNET_VAULT_SLUG",
  "MAINNET_VAULT_RISK_TIER",
];
const check = (condition, code) => {
  if (!condition) throw new Error(code);
};

try {
  check(process.argv.length === 2, "NO_PROFILE_OVERRIDE_ALLOWED");
  execFileSync("git", ["check-ignore", "-q", profile], { stdio: "pipe" });
  check(
    !execFileSync("git", ["ls-files", "--", profile], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim(),
    "PROFILE_MUST_NOT_BE_TRACKED",
  );
  check((statSync(profile).mode & 0o077) === 0, "PROFILE_REQUIRES_MODE_0600");
  const env = parseEnv(readFileSync(profile, "utf8"));
  check(
    env.NETWORK_MODE === "MAINNET" && env.CHAIN_ID === "4663",
    "ROBINHOOD_MAINNET_REQUIRED",
  );
  check(env.MAINNET_DEPLOYMENT_SCOPE === "CORE_ONLY", "CORE_ONLY_REQUIRED");
  check(
    ["TRADING_ENABLED", "LENDING_ENABLED", "MARGIN_TRADING_ENABLED"].every(
      (key) => env[key] === "false",
    ),
    "MARKET_EXECUTION_MUST_REMAIN_DISABLED",
  );
  check(
    env.MAINNET_CORE_BROADCAST_ENABLED === "false",
    "PREPARATION_REQUIRES_BROADCAST_DISABLED",
  );
  const missingVariables = required.filter((key) => !env[key]?.trim());
  const invalidVariables = required.filter((key) => {
    const value = env[key];
    if (!value?.trim()) return false;
    if (key.endsWith("_ADDRESS"))
      return !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/.test(value);
    if (key === "PRIVATE_KEY")
      return !/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/.test(value);
    if (key === "MAINNET_VAULT_ASSET_CODE_HASH")
      return !/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/.test(value);
    if (["MAINNET_VAULT_ASSET_SYMBOL", "MAINNET_VAULT_NAME", "MAINNET_VAULT_SYMBOL", "MAINNET_VAULT_SLUG", "MAINNET_VAULT_RISK_TIER"].includes(key))
      return !/^[A-Za-z0-9 _-]{1,80}$/.test(value);
    if (key === "MAINNET_VAULT_ASSET_DECIMALS")
      return !/^(0|[1-9][0-9]*)$/.test(value) || Number(value) > 255;
    if (key === "RPC_URL") {
      try {
        return new URL(value).protocol !== "https:";
      } catch {
        return true;
      }
    }
    return !/^[1-9][0-9]*$/.test(value);
  });
  if (
    !missingVariables.length &&
    !invalidVariables.length &&
    BigInt(env.MAINNET_MAX_TOTAL_GAS_WEI) <
      BigInt(env.MAINNET_MAX_TRANSACTION_GAS_WEI)
  )
    invalidVariables.push("MAINNET_MAX_TOTAL_GAS_WEI");

  console.log(
    JSON.stringify(
      {
        status:
          missingVariables.length || invalidVariables.length
            ? "CONFIGURATION_INCOMPLETE"
            : "CONFIGURATION_PRESENT_UNVERIFIED",
        chainId: Number(env.CHAIN_ID),
        scope: "CORE_ONLY",
        contracts: [
          "LeveraMarketRegistry",
          "LeveraRouter",
          "AutoProtectModule",
          "ShortRouter",
          "LeveraVault",
        ],
        missingVariables,
        invalidVariables,
        plannedMarketCount: 0,
        plannedRouterAuthorizations: 0,
        plannedAutoProtectPaused: true,
        plannedShortRouterPaused: true,
        plannedVaultDepositsPaused: true,
        networkRequests: 0,
        transactionsSubmitted: 0,
        readyToBroadcast: false,
        note: "Offline inventory only. Signer identity, RPC chain, funds, bytecode, gas estimates and deployment execution remain unverified. Testnet application configuration is untouched.",
      },
      null,
      2,
    ),
  );
  if (missingVariables.length || invalidVariables.length) process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  console.error(
    /^[A-Z][A-Z0-9_]+$/.test(message)
      ? message
      : "MAINNET_CORE_PREPARATION_FAILED_DETAILS_REDACTED",
  );
  process.exitCode = 1;
}
