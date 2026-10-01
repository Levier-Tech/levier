import dotenv from "dotenv";
import path from "path";
import { z } from "zod";

// Robinhood Chain testnet (46630) or mainnet (4663); NETWORK_MODE and CHAIN_ID must agree.
dotenv.config({ path: path.resolve(process.cwd(), "../../.env.testnet") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.testnet") });

const configSchema = z.object({
  NETWORK_MODE: z.enum(["TESTNET", "MAINNET"]),
  TRADING_ENABLED: z
    .enum(["true", "false"])
    .transform((value) => value === "true"),
  CHAIN_ID: z.enum(["46630", "4663"]).transform(Number),
  RPC_URL: z.string().url(),
  KEEPER_PRIVATE_KEY: z
    .string()
    .regex(
      /^0x[a-fA-F0-9]{64}$/,
      "KEEPER_PRIVATE_KEY must be a 64-character hex string with 0x prefix",
    ),
  AUTO_PROTECT_ADDRESS: z
    .string()
    .regex(
      /^0x[a-fA-F0-9]{40}$/,
      "AUTO_PROTECT_ADDRESS must be a valid EVM address",
    ),
  ORACLE_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "ORACLE_ADDRESS must be a valid EVM address"),
  MARKET_REGISTRY_ADDRESS: z
    .string()
    .regex(
      /^0x[a-fA-F0-9]{40}$/,
      "MARKET_REGISTRY_ADDRESS must be a valid EVM address",
    ),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  // Server-side writes; table write policies are limited to the service role.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  POLL_INTERVAL_MS: z.coerce.number().int().positive(),
  MAX_GAS_PRICE_GWEI: z.coerce.number().positive(),
}).refine(
  (c) => c.CHAIN_ID === (c.NETWORK_MODE === "MAINNET" ? 4663 : 46630),
  { path: ["CHAIN_ID"], message: "CHAIN_ID does not match NETWORK_MODE" },
);

const _parsed = configSchema.safeParse({
  NETWORK_MODE: process.env.NETWORK_MODE,
  TRADING_ENABLED: process.env.TRADING_ENABLED,
  CHAIN_ID: process.env.CHAIN_ID,
  RPC_URL: process.env.RPC_URL,
  KEEPER_PRIVATE_KEY: process.env.KEEPER_PRIVATE_KEY,
  AUTO_PROTECT_ADDRESS: process.env.AUTO_PROTECT_ADDRESS,
  ORACLE_ADDRESS: process.env.ORACLE_ADDRESS,
  MARKET_REGISTRY_ADDRESS: process.env.MARKET_REGISTRY_ADDRESS,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
  POLL_INTERVAL_MS: process.env.POLL_INTERVAL_MS,
  MAX_GAS_PRICE_GWEI: process.env.MAX_GAS_PRICE_GWEI,
});

if (!_parsed.success) {
  console.error("[KEEPER CONFIG ERROR] Invalid keeper environment variables:");
  console.error(
    _parsed.error.issues.map((issue) => issue.path.join(".")).join(", "),
  );
  throw new Error(
    "Keeper configuration validation failed. Please check your .env.testnet file.",
  );
}

export const config = _parsed.data;
