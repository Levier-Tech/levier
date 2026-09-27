import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, delimiter } from "node:path";
import { context, assert, save, safeFailure } from "./lib/rh-live.mjs";
import { parseModulesConfig, verifyModuleInputs } from "./lib/rh-modules.mjs";

try {
  assert(process.argv.length === 3, "EXPLICIT_TESTNET_PROFILE_REQUIRED");
  const ctx = await context(process.argv[2]);
  await verifyModuleInputs(
    ctx,
    parseModulesConfig(ctx.env.RH_MODULES_CONFIG_JSON),
  );
  const directory = `.secrets/rh-suite/simulation-${Date.now()}`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  let output;
  try {
    // No --broadcast, --skip-simulation or extra caller-supplied arguments are accepted.
    output = execFileSync(
      "forge",
      [
        "script",
        "script/DeployRhModules.s.sol:DeployRhModules",
        "--rpc-url",
        "robinhood_testnet",
      ],
      {
        cwd: "packages/contracts",
        env: {
          ...process.env,
          ...ctx.env,
          PATH: [join(homedir(), ".foundry/bin"), process.env.PATH].join(
            delimiter,
          ),
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 240000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
  } catch {
    throw Error("MODULE_SIMULATION_FAILED_NO_BROADCAST");
  }
  for (const [key, value] of Object.entries(ctx.env))
    if (
      /PRIVATE_KEY|RPC_URL|DATABASE_URL|SUPABASE/.test(key) &&
      value.length > 8
    ) {
      output = output.replaceAll(value, "[REDACTED]");
      if (/PRIVATE_KEY/.test(key) && /^0x[0-9a-fA-F]{64}$/.test(value))
        output = output.replaceAll(String(BigInt(value)), "[REDACTED]");
    }
  writeFileSync(`${directory}/simulation.log`, output, {
    flag: "wx",
    mode: 0o600,
  });
  mkdirSync("docs/evidence/rh-suite-preparation", { recursive: true });
  const report = {
    capturedAt: new Date().toISOString(),
    chainId: 46630,
    simulationPassed: true,
    transactionsSubmitted: 0,
    contracts: [
      "LeverageRouter",
      "ShortRouter",
      "AutoProtectModule",
      "LevierVault",
    ],
    verified: [
      "Existing registry/router identity and authorization",
      "Existing issuer-documented USDG, 6 decimals",
      "All four modules begin closed",
      "No incomplete router authorization",
      "Vault starts empty without allocations",
    ],
    limits: [
      "Live-RPC dry run; no contracts were deployed by this command",
      "Oracle/pair and funded lifecycle remain separate",
    ],
  };
  save("docs/evidence/rh-suite-preparation/simulation.json", report);
  console.log(JSON.stringify(report));
} catch (error) {
  safeFailure(error);
}
