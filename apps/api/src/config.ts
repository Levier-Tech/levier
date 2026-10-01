import dotenv from "dotenv";
import path from "path";
import { z } from "zod";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), "../../.env.testnet") });
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.testnet") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const envSchema = z.object({
  PORT: z.string().regex(/^[1-9]\d*$/),
  NODE_ENV: z.enum(["development", "production", "test"]),
  SUPABASE_URL: z.string().url({ message: "SUPABASE_URL must be a valid URL" }),
  SUPABASE_ANON_KEY: z
    .string()
    .min(1, { message: "SUPABASE_ANON_KEY is required" }),
  // Server-side writes; table write policies are limited to the service role.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  NETWORK_MODE: z.enum(["TESTNET", "MAINNET"]),
  API_BIND_HOST: z.enum(["127.0.0.1", "::1", "0.0.0.0"]),
  WEB_ORIGIN: z.string().url(),
  TRADING_ENABLED: z
    .enum(["true", "false"])
    .transform((value) => value === "true"),
});

const sanitizedEnv: Record<string, string | undefined> = {};
for (const [key, value] of Object.entries(process.env)) {
  sanitizedEnv[key] =
    typeof value === "string"
      ? value.trim().replace(/^["']+|["']+$/g, "")
      : value;
}

const parsed = envSchema.safeParse(sanitizedEnv);

if (!parsed.success) {
  console.error("[API Config] Critical: Invalid Environment Configuration:");
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  throw new Error(
    "[API Config] Environment validation failed. Halting startup.",
  );
}

export const config = parsed.data;
