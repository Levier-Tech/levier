#!/usr/bin/env bash
# Interactive Robinhood Chain MAINNET (chain 4663) deployment of every non-Pons contract:
# core, VerifiedFeedOracle, long + short LevierPair per market, LeverageRouter, Uniswap V2
# factory + pools, MarginRouter per market. All markets PAUSED, all modules paused.
# Resumable: every transaction is journaled in .secrets/rh-mainnet-full. Re-run this script
# after any interruption and it continues from the journal instead of re-planning.
# Broadcast is enabled in the profile only for the --deploy step and always switched back off.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ENV_FILE=".env.mainnet.core.local"
STATE=".secrets/rh-mainnet-full/state.json"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE"; exit 1; }

confirm() {
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
}

set_broadcast() {
  sed -i "s/^MAINNET_FULL_BROADCAST_ENABLED=.*/MAINNET_FULL_BROADCAST_ENABLED=$1/" "$ENV_FILE"
}
trap 'set_broadcast false' EXIT
set_broadcast false

echo "== Step 1/5: build and test contracts =="
(cd packages/contracts && forge build && forge test)

if [ -f "$STATE" ]; then
  echo "== Step 2/5: journal found, resuming the existing deployment (no re-plan) =="
else
  echo "== Step 2/5: plan = full rehearsal on a local fork of mainnet (no mainnet transactions) =="
  pnpm rh:mainnet:full:plan
  echo "Plan saved to .secrets/rh-mainnet-full/plan.json."
  echo "Do not send any other transaction from the deployer until step 3 finishes; the plan is bound to its nonce."
fi
confirm "Review the addresses and estimated fee above. Continue?"

echo "== Step 3/5: deploy (BROADCASTS to Robinhood Chain MAINNET 4663, real ETH) =="
read -r -p "Type DEPLOY MAINNET to broadcast: " phrase
[ "$phrase" = "DEPLOY MAINNET" ] || { echo "Aborted."; exit 1; }
set_broadcast true
pnpm rh:mainnet:full:deploy
set_broadcast false

echo "== Step 4/5: verify on-chain state =="
pnpm rh:mainnet:full:verify

echo "== Step 5/5: done =="
echo "Deployment record: packages/contracts/deployments/mainnet-4663.json"
echo "Every market is PAUSED. Nothing is usable until markets are deliberately enabled."
