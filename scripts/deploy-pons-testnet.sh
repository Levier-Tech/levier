#!/usr/bin/env bash
# Interactive RH Testnet (chain 46630) deploy of the Pons contract group.
# Deploys: PonsOracleRouter, PonsMarketAdapter, PonsLeverageRegistry, PonsRiskEngine,
# LeveragePositionManager, PonsAutoProtectModule (plus mock PMEME/PGOV testnet tokens).
# Reuses the real faucet USDG from USDG_ADDRESS. Output: packages/contracts/deployments/pons-testnet-46630.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env.testnet"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE"; exit 1; }

# Load only what the script needs; never echo the private key.
set -a
# shellcheck disable=SC1090
. <(grep -E "^(RPC_URL|PRIVATE_KEY|USDG_ADDRESS)=" "$ENV_FILE")
set +a
: "${RPC_URL:?RPC_URL missing}" "${PRIVATE_KEY:?PRIVATE_KEY missing}" "${USDG_ADDRESS:?USDG_ADDRESS missing}"

confirm() {
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
}

cd "$ROOT/packages/contracts"
DEPLOYER="$(cast wallet address --private-key "$PRIVATE_KEY")"

echo "== Step 1/4: environment =="
echo "Chain ID : $(cast chain-id --rpc-url "$RPC_URL")"
echo "Deployer : $DEPLOYER"
echo "Balance  : $(cast balance "$DEPLOYER" --rpc-url "$RPC_URL" --ether) ETH (testnet)"
echo "USDG     : $USDG_ADDRESS (real faucet token, reused)"
confirm "Continue?"

echo "== Step 2/4: build =="
forge build
confirm "Build ok. Run dry-run simulation (no broadcast)?"

echo "== Step 3/4: dry-run =="
forge script script/DeployPons.s.sol --rpc-url "$RPC_URL"
confirm "Dry-run ok. BROADCAST to chain 46630 now?"

echo "== Step 4/4: broadcast =="
forge script script/DeployPons.s.sol --rpc-url "$RPC_URL" --broadcast

echo
echo "Done. Addresses: packages/contracts/deployments/pons-testnet-46630.json"
echo "Broadcast log  : packages/contracts/broadcast/DeployPons.s.sol/46630/run-latest.json"
echo "Next: record addresses in DEPLOYMENT_RECEIPT.md, then run: pnpm generate:lending-abis"
