import { PriceOracleWorker } from "./worker.js";

async function main() {
  const worker = new PriceOracleWorker();
  process.on("SIGINT", () => worker.stop());
  process.on("SIGTERM", () => worker.stop());
  if (process.argv.slice(2).length === 1 && process.argv[2] === "--once") {
    console.log(JSON.stringify(await worker.observeOnce(), null, 2));
    return;
  }
  if (process.argv.length !== 2) throw new Error("Unsupported arguments");
  await worker.start();
}
main().catch((err) => {
  console.error(
    `[PriceOracleWorker] Startup failed: ${err?.message || err}. Check oracle ENV configuration; values redacted.`,
  );
  process.exitCode = 1;
});
