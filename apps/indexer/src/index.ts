import { main } from "../../../scripts/run-rh-indexer.mjs";
main(process.argv.slice(2)).catch(() => {
  console.error(
    "RH indexer stopped: configuration, RPC or database verification failed. Provider details are redacted; reconcile checkpoints before restarting.",
  );
  process.exitCode = 1;
});
