#!/usr/bin/env bash
# Deploys Pons leverage (oracle, LP vault, manager) to mainnet in one interactive run:
#   npm run rh:mainnet:pons:interactive
# Rehearsed on a fork first and journaled, so a re-run resumes. Everything stays closed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ENV_FILE=".env.mainnet.core.local"
FLAG="MAINNET_PONS_BROADCAST_ENABLED"
grep -q "^$FLAG=" "$ENV_FILE" || printf '\n%s=false\n' "$FLAG" >> "$ENV_FILE"
set_flag() { sed -i "s/^$FLAG=.*/$FLAG=$1/" "$ENV_FILE"; }
trap 'set_flag false' EXIT
set_flag false

(cd packages/contracts && forge build && forge test --match-contract PonsPerpTest)

if [ -f ".secrets/rh-mainnet-pons/state.json" ]; then
  echo "Journal found, resuming."
else
  node scripts/deploy-rh-mainnet-pons.mjs --plan
fi
read -r -p "Rehearsal above passed. Type DEPLOY PONS to broadcast to MAINNET (real ETH): " phrase
[ "$phrase" = "DEPLOY PONS" ] || { echo "Aborted."; exit 1; }
set_flag true
node scripts/deploy-rh-mainnet-pons.mjs --run
set_flag false
node scripts/deploy-rh-mainnet-pons.mjs --verify
echo "Pons leverage is deployed and closed. Tell Claude: \"pons deployed\"."
