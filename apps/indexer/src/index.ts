import { main } from "../../../scripts/run-rh-indexer.mjs";
main(process.argv.slice(2)).catch((error) => {
  // Only stable codes are logged (our UPPER_SNAKE errors, Postgres SQLSTATE, Node/JS error
  // names); messages can carry provider URLs or credentials and stay redacted.
  const message = error instanceof Error ? error.message : "";
  const code = /^[A-Z][A-Z0-9_]+$/.test(message)
    ? message
    : typeof error?.code === "string" && /^[A-Z0-9_]{2,40}$/.test(error.code)
      ? error.code
      : error instanceof Error
        ? error.name
        : "UNKNOWN";
  console.error(
    `RH indexer stopped (${code}): configuration, RPC or database verification failed. Provider details are redacted; reconcile checkpoints before restarting.`,
  );
  process.exitCode = 1;
});
