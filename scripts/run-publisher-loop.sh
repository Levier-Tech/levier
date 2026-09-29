#!/usr/bin/env bash
# Keep the RH testnet price publisher running for long test sessions.
# The publisher stops itself after maxRunSeconds (3600) or on any error, and pauses the markets when it stops.
# This loop starts it again after a pause. The delay also protects the Kraken websocket rate limit (HTTP 429).
# Stop with Ctrl+C (or kill this script), then run `pnpm rh:markets:pause` if a market is still active.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DELAY="${PUBLISHER_RESTART_DELAY:-90}"
trap 'echo "Loop stopped."; exit 0' INT TERM
while true; do
  echo "$(date -u +%H:%M:%S) starting publisher"
  pnpm rh:publisher:serve
  code=$?
  echo "$(date -u +%H:%M:%S) publisher exited (code $code). Restarting in ${DELAY}s. Ctrl+C to stop."
  sleep "$DELAY" || exit 0
done
