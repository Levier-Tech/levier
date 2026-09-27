import { config } from "./config.js";
import { keeperAccount } from "./client.js";
import { scanPositions } from "./services/positionMonitor.js";
import { executeCandidateProtection } from "./services/executionService.js";

let isRunning = true;

async function runKeeperLoop() {
  if (!config.TRADING_ENABLED) {
    console.log("[KEEPER] Execution disabled pending testnet validation. Daemon is in standby mode.");
    await new Promise(() => {});
    return;
  }
  console.log("===========================================================");
  console.log("       LEVIER PROTOCOL — AUTO-PROTECT KEEPER BOT           ");
  console.log("===========================================================");
  console.log(
    `[NETWORK]          : ${config.NETWORK_MODE} (Chain ID: ${config.CHAIN_ID})`,
  );
  console.log(`[KEEPER ADDRESS]   : ${keeperAccount.address}`);
  console.log(`[AUTO-PROTECT]     : ${config.AUTO_PROTECT_ADDRESS}`);
  console.log(`[POLL INTERVAL]    : ${config.POLL_INTERVAL_MS}ms`);
  console.log(`[GAS CEILING]      : ${config.MAX_GAS_PRICE_GWEI} Gwei`);
  console.log("===========================================================");
  console.log(
    "[KEEPER] Initializing active position health monitor daemon...\n",
  );

  let cycle = 1;

  while (isRunning) {
    try {
      const startTime = Date.now();
      const candidates = await scanPositions();
      const elapsed = Date.now() - startTime;

      if (candidates.length > 0) {
        console.warn(
          `[CYCLE #${cycle}] Found ${candidates.length} positions breaching safety thresholds!`,
        );

        for (const candidate of candidates) {
          await executeCandidateProtection(candidate);
        }
      } else {
        process.stdout.write(
          `\r[CYCLE #${cycle}] Monitored active positions. 0 safety breaches detected (${elapsed}ms).   `,
        );
      }

      cycle++;
    } catch (err) {
      console.error(
        `\n[KEEPER LOOP ERROR] Cycle #${cycle} failed; provider details redacted.`,
      );
    }

    if (isRunning) {
      await new Promise((resolve) =>
        setTimeout(resolve, config.POLL_INTERVAL_MS),
      );
    }
  }

  console.log("\n[KEEPER] Shutdown completed gracefully.");
}

// Graceful termination
process.on("SIGINT", () => {
  console.log("\n[KEEPER] Interrupted via SIGINT. Exiting...");
  isRunning = false;
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[KEEPER] Terminated via SIGTERM. Exiting...");
  isRunning = false;
  process.exit(0);
});

// Start loop
runKeeperLoop().catch((err) => {
  console.error(
    "[KEEPER FATAL ERROR] Startup failed; private details redacted.",
  );
  process.exit(1);
});
