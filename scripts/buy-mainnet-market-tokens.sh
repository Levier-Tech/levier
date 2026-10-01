#!/usr/bin/env bash
# Interactive purchase of the micro market-opening tokens with the deployer's ETH (Uniswap v3,
# Robinhood Chain mainnet). Rehearses on a fork first; broadcast is enabled only for the real run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ENV_FILE=".env.mainnet.core.local"
grep -q '^MAINNET_SWAP_BROADCAST_ENABLED=' "$ENV_FILE" || printf '\nMAINNET_SWAP_BROADCAST_ENABLED=false\n' >> "$ENV_FILE"

set_broadcast() {
  sed -i "s/^MAINNET_SWAP_BROADCAST_ENABLED=.*/MAINNET_SWAP_BROADCAST_ENABLED=$1/" "$ENV_FILE"
}
trap 'set_broadcast false' EXIT
set_broadcast false

echo "== Step 1/2: quote and rehearse on a local fork of mainnet (no mainnet transactions) =="
node scripts/buy-mainnet-market-tokens.mjs --plan
read -r -p "Review the amounts and ETH cost above. Continue? [y/N] " reply
[[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }

echo "== Step 2/2: swap on Robinhood Chain MAINNET (real ETH) =="
read -r -p "Type BUY TOKENS to broadcast: " phrase
[ "$phrase" = "BUY TOKENS" ] || { echo "Aborted."; exit 1; }
set_broadcast true
node scripts/buy-mainnet-market-tokens.mjs --run
set_broadcast false
echo "Done. Next: npm run rh:mainnet:markets:interactive"
