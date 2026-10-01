#!/usr/bin/env bash
# Interactive Robinhood Chain MAINNET (chain 4663) deploy of the core contracts:
# LevierMarketRegistry, LevierRouter, AutoProtectModule, ShortRouter, LevierVault.
# All deploy paused with zero markets. Resumable: every tx is journaled in .secrets/rh-mainnet-core.
# Broadcast is enabled in the profile only for the --deploy step and always switched back off.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ENV_FILE=".env.mainnet.core.local"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE (copy .env.mainnet.core.example)"; exit 1; }

confirm() {
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
}

set_broadcast() {
  sed -i "s/^MAINNET_CORE_BROADCAST_ENABLED=.*/MAINNET_CORE_BROADCAST_ENABLED=$1/" "$ENV_FILE"
}
trap 'set_broadcast false' EXIT
set_broadcast false

echo "== Step 1/5: offline profile check =="
pnpm rh:mainnet:core:prepare

echo "== Step 2/5: build contracts (artifacts must match sources) =="
(cd packages/contracts && forge build)

echo "== Step 3/5: read-only plan (no transactions) =="
pnpm rh:mainnet:core:plan
echo "Plan saved to .secrets/rh-mainnet-core/plan.json."
echo "Do not send any other transaction from the deployer until step 4 finishes; the plan is bound to its nonce."
confirm "Review the predicted addresses, owner and estimated fee above. Continue?"

echo "== Step 4/5: deploy (BROADCASTS to Robinhood Chain MAINNET 4663, real ETH) =="
read -r -p "Type DEPLOY MAINNET to broadcast: " phrase
[ "$phrase" = "DEPLOY MAINNET" ] || { echo "Aborted."; exit 1; }
set_broadcast true
pnpm rh:mainnet:core:deploy
set_broadcast false

echo "== Step 5/5: verify on-chain state =="
pnpm rh:mainnet:core:verify
echo "Done. Next: record addresses in docs/mainnet-deployment-plan.md (Section 4) and verify sources on Blockscout."
