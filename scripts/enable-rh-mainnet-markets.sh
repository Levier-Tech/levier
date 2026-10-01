#!/usr/bin/env bash
# Interactive opening of the four Robinhood Chain MAINNET markets at minimum demo size.
# Needs, in the deployer wallet, the USDG and stock amounts printed by the plan (size: MAINNET_ENABLE_SIZE).
# Resumable: every transaction is journaled in .secrets/rh-mainnet-enable.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ENV_FILE=".env.mainnet.core.local"
STATE=".secrets/rh-mainnet-enable/state.json"

confirm() {
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
}
set_broadcast() {
  sed -i "s/^MAINNET_ENABLE_BROADCAST_ENABLED=.*/MAINNET_ENABLE_BROADCAST_ENABLED=$1/" "$ENV_FILE"
}
trap 'set_broadcast false' EXIT
set_broadcast false

if [ -f "$STATE" ]; then
  echo "== Step 1/3: journal found, resuming (no re-plan) =="
else
  echo "== Step 1/3: rehearse on a local fork of mainnet (no mainnet transactions) =="
  pnpm rh:mainnet:markets:plan
  echo "Check 'shortfall' above: every value must be 0 before you continue."
fi
confirm "Continue?"

echo "== Step 2/3: open markets (BROADCASTS to Robinhood Chain MAINNET 4663, real funds) =="
echo "Funds sent to the lending pairs cannot be withdrawn; only the pool LP tokens can."
read -r -p "Type OPEN MARKETS to broadcast: " phrase
[ "$phrase" = "OPEN MARKETS" ] || { echo "Aborted."; exit 1; }
set_broadcast true
pnpm rh:mainnet:markets:run
set_broadcast false

echo "== Step 3/3: verify =="
pnpm rh:mainnet:markets:verify
echo "Markets are open on-chain. Ask Claude to switch on LENDING_ENABLED and MARGIN_TRADING_ENABLED in the app."
