import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { X509Certificate } from "node:crypto";
import postgres from "postgres";
const requireKeeper = createRequire(
  new URL("../apps/keeper/package.json", import.meta.url),
);
const { privateKeyToAccount } = requireKeeper("viem/accounts");
const { isAddress, formatEther } = requireKeeper("viem");
const [profile, outputDirectory] = process.argv.slice(2);
const report = {
  capturedAt: new Date().toISOString(),
  checks: {},
  issues: [],
  transactionsSubmitted: 0,
  databaseWrites: 0,
  testnetReady: false,
};
let env;
function issue(code) {
  report.issues.push(code);
}
async function check(name, fn) {
  try {
    report.checks[name] = await fn();
  } catch {
    report.checks[name] = { passed: false };
    issue(
      `${name}: failed; inspect local configuration without sharing secrets`,
    );
  }
}
try {
  if (!profile || !outputDirectory)
    throw Error("Explicit profile and output directory required");
  env = parseEnv(readFileSync(profile, "utf8"));
  if (
    env.NETWORK_MODE !== "TESTNET" ||
    env.CHAIN_ID !== "46630" ||
    env.TRADING_ENABLED !== "false"
  )
    throw Error("Testnet-only disabled execution profile required");
  await check("localProfileProtection", async () => {
    execFileSync("git", ["check-ignore", "-q", profile]);
    if (
      execFileSync("git", ["ls-files", "--", profile], {
        encoding: "utf8",
      }).trim()
    )
      throw Error();
    if ((statSync(profile).mode & 0o077) !== 0) throw Error();
    return { passed: true };
  });
  const accounts = {};
  for (const [role, keyName, addressName] of [
    ["deployer", "PRIVATE_KEY", "DEPLOYER_ADDRESS"],
    ["keeper", "KEEPER_PRIVATE_KEY", "KEEPER_ADDRESS"],
  ]) {
    await check(`${role}Identity`, async () => {
      if (
        !/^0x[0-9a-fA-F]{64}$/.test(env[keyName] ?? "") ||
        !isAddress(env[addressName] ?? "")
      )
        throw Error();
      const account = privateKeyToAccount(env[keyName]);
      const matches =
        account.address.toLowerCase() === env[addressName].toLowerCase();
      if (!matches) throw Error();
      accounts[role] = account.address;
      return { passed: true, configuredAddressMatchesKey: true };
    });
  }
  await check("testerIdentity", async () => {
    if (
      !isAddress(env.TESTER_ADDRESS ?? "") ||
      /^0x0{40}$/i.test(env.TESTER_ADDRESS)
    )
      throw Error();
    accounts.tester = env.TESTER_ADDRESS;
    return { passed: true, privateKeyRequired: false };
  });
  report.checks.roleSeparation = {
    allWalletsDistinct:
      Object.keys(accounts).length === 3 &&
      new Set(Object.values(accounts).map((a) => a.toLowerCase())).size === 3,
  };
  let rpcId = 0;
  async function rpc(method, params) {
    const response = await fetch(env.RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error();
    const body = await response.json();
    if (body.error || body.result === undefined) throw Error();
    return body.result;
  }
  await check("rpcAndGas", async () => {
    const chainId = Number(BigInt(await rpc("eth_chainId", [])));
    if (chainId !== 46630) throw Error();
    const block = await rpc("eth_blockNumber", []);
    const wallets = {};
    for (const [role, address] of Object.entries(accounts)) {
      const balance = BigInt(await rpc("eth_getBalance", [address, block]));
      wallets[role] = {
        balanceEth: formatEther(balance),
        hasGas: balance > 0n,
      };
      if (balance === 0n) issue(`${role}: requires RH-testnet ETH for gas`);
    }
    return {
      passed: true,
      chainId,
      block: BigInt(block).toString(),
      wallets,
      note: "Positive balance is not a deployment gas estimate",
    };
  });
  let projectRef;
  await check("databaseProjectConfiguration", async () => {
    const supabase = new URL(env.SUPABASE_URL);
    if (
      supabase.protocol !== "https:" ||
      !/^[a-z0-9]+\.supabase\.co$/.test(supabase.hostname)
    )
      throw Error();
    projectRef = supabase.hostname.split(".")[0];
    const database = new URL(env.DATABASE_URL);
    if (
      !["postgres:", "postgresql:"].includes(database.protocol) ||
      !/^[1-9]\d*$/.test(database.port) ||
      Number(database.port) > 65535 ||
      !database.pathname.slice(1)
    )
      throw Error();
    const directMatch = database.hostname === `db.${projectRef}.supabase.co`;
    const poolerMatch =
      database.hostname.endsWith(".pooler.supabase.com") &&
      decodeURIComponent(database.username).endsWith(`.${projectRef}`);
    if (!directMatch && !poolerMatch) throw Error();
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw Error();
    if (key.split(".").length === 3) {
      const claims = JSON.parse(
        Buffer.from(key.split(".")[1], "base64url").toString(),
      );
      if (claims.ref !== projectRef || claims.role !== "service_role")
        throw Error();
    } else if (!key.startsWith("sb_secret_")) throw Error();
    return {
      passed: true,
      databaseMatchesSupabaseProject: true,
      sessionPooler: poolerMatch && database.port === "5432",
      note: "Local claims matching is followed by authenticated server read",
    };
  });
  if (report.checks.databaseProjectConfiguration.passed) {
    await check("supabaseServerRead", async () => {
      const url = new URL("/rest/v1/markets", env.SUPABASE_URL);
      url.searchParams.set("select", "network");
      url.searchParams.set("network", "eq.TESTNET");
      url.searchParams.set("limit", "1");
      const response = await fetch(url, {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          ...(env.SUPABASE_SERVICE_ROLE_KEY.startsWith("eyJ")
            ? { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
            : {}),
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok || !Array.isArray(await response.json())) throw Error();
      return {
        passed: true,
        authenticatedRead: true,
        writePermissionsTested: false,
      };
    });
    await check("databaseTlsRead", async () => {
      const u = new URL(env.DATABASE_URL);
      if (!env.DATABASE_SSL_CA_PATH || !env.DATABASE_SSL_CA_SHA256)
        throw Error();
      const ca = readFileSync(resolve(env.DATABASE_SSL_CA_PATH), "utf8");
      const certificate = new X509Certificate(ca);
      if (
        !certificate.ca ||
        certificate.fingerprint256.replaceAll(":", "").toLowerCase() !==
          env.DATABASE_SSL_CA_SHA256 ||
        Date.parse(certificate.validFrom) > Date.now() ||
        Date.parse(certificate.validTo) <= Date.now()
      )
        throw Error();
      const sql = postgres({
        host: u.hostname,
        port: Number(u.port),
        username: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        database: decodeURIComponent(u.pathname.slice(1)),
        ssl: {
          rejectUnauthorized: true,
          servername: u.hostname,
          ca,
        },
        max: 1,
        prepare: false,
        fetch_types: false,
        connect_timeout: 10,
        connection: { statement_timeout: 10000 },
        onnotice() {},
      });
      try {
        const result = await sql.begin("read only", async (tx) => {
          const tls =
            await tx`SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()`;
          const tables =
            await tx`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('markets', 'user_positions', 'vaults') ORDER BY table_name`;
          return {
            tls: tls[0]?.ssl === true,
            tables: tables.map((row) => row.table_name),
          };
        });
        if (!result.tables.includes("markets")) throw Error();
        return {
          passed: true,
          verifiedTls: true,
          databaseBackendTlsObserved: result.tls,
          readOnlyTransaction: true,
          rhTablesFound: result.tables,
        };
      } catch (error) {
        const codes = [
          "SELF_SIGNED_CERT_IN_CHAIN",
          "ERR_TLS_CERT_ALTNAME_INVALID",
          "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
          "42P01",
          "42501",
          "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
          "CERT_HAS_EXPIRED",
          "28P01",
          "ENETUNREACH",
          "ENOTFOUND",
          "CONNECT_TIMEOUT",
        ];
        if (codes.includes(error?.code))
          issue(`databaseTlsRead: ${error.code}`);
        throw Error();
      } finally {
        await sql.end({ timeout: 2 });
      }
    });
  }
  report.preparationPassed = report.issues.length === 0;
  mkdirSync(outputDirectory, { recursive: true });
  const output = JSON.stringify(report, null, 2) + "\n";
  for (const [key, value] of Object.entries(env))
    if (
      /PRIVATE_KEY|DATABASE_URL|SUPABASE|RPC_URL/.test(key) &&
      value.length >= 12 &&
      output.includes(value)
    )
      throw Error("Report redaction check failed");
  writeFileSync(resolve(outputDirectory, "preparation.json"), output, {
    flag: "wx",
  });
  console.log(output);
  if (!report.preparationPassed) process.exitCode = 1;
} catch {
  console.error(
    "RH preparation check could not complete. Verify profile, network, and unused output directory locally; values redacted.",
  );
  process.exitCode = 1;
}
