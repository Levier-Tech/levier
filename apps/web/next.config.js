const {
  clientSchema,
  serverSchema,
  validate,
} = require("./config/environment.cjs");
const { PHASE_PRODUCTION_BUILD } = require("next/constants");
// Explicit public projection: never serialize server credentials or upstream URLs.
const publicKeys = [
  "NETWORK_MODE",
  "CHAIN_ID",
  "CHAIN_NAME",
  "EXPLORER_URL",
  "NATIVE_CURRENCY_NAME",
  "NATIVE_CURRENCY_SYMBOL",
  "NATIVE_CURRENCY_DECIMALS",
  "USDG_ADDRESS",
  "PROTOCOL_ADDRESSES",
  "TRADING_ENABLED",
  "UI_POLL_INTERVAL_MS",
  "MARGIN_TRADING_ENABLED",
  "MARKET_DEPLOYMENTS_JSON",
  "MARGIN_DEPLOYMENT_JSON",
  "LENDING_ENABLED",
  "LENDING_DEPLOYMENT_JSON",
  "LENDING_RECEIPT_CONFIRMATIONS",
  "LENDING_RECEIPT_TIMEOUT_MS",
  "USDG_FAUCET_URL",
  "TOKEN_CA",
  "NEXT_PUBLIC_TOKEN_CA",
];
/** @type {import('next').NextConfig} */
module.exports = (phase) => {
  validate(clientSchema, process.env);
  // Build consumes public configuration only. Credentials are injected when
  // the server starts, and are never written into a Docker image layer.
  if (phase !== PHASE_PRODUCTION_BUILD) validate(serverSchema, process.env);
  let backend;
  try {
    backend = new URL(process.env.BACKEND_API_URL);
    if (
      !["https:", "http:"].includes(backend.protocol) ||
      backend.username ||
      backend.password ||
      backend.search ||
      backend.hash
    )
      throw Error();
  } catch {
    throw Error("Invalid ENV field: BACKEND_API_URL");
  }
  return {
    reactStrictMode: true,
    transpilePackages: ["@levera/types"],
    env: Object.fromEntries(publicKeys.map((key) => [key, process.env[key]])),
    async rewrites() {
      return [
        {
          source: "/api/v1/:path*",
          destination: `${backend.href.replace(/\/$/, "")}/api/v1/:path*`,
        },
      ];
    },
    webpack(config) {
      // Shared NodeNext services emit .js imports while development sources are TypeScript.
      config.resolve.extensionAlias = {
        ...config.resolve.extensionAlias,
        ".js": [".ts", ".tsx", ".js"],
      };
      config.resolve.fallback = { fs: false, net: false, tls: false };
      return config;
    },
  };
};
