#!/usr/bin/env bash
# Prepare the deployed Levier testnet site for feature testing.
#   1. Ensure the TSLA long + short markets are paused; the price publisher activates them once prices are fresh and pauses them on exit.
#   2. Sync Railway web variables: enabled market list, margin descriptor, feature flags (triggers a rebuild).
#   3. Mirror the same flags into apps/web/.env for local dev.
#   4. Run the price publisher in the foreground so oracle prices stay fresh while you test.
# Usage: enable-testnet-site.sh [--yes] [--dry-run]     Undo: pnpm rh:markets:pause + set the flags back to false.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
YES=0; DRY=0
for a in "$@"; do case "$a" in --yes) YES=1;; --dry-run) DRY=1;; *) echo "Unknown flag: $a"; exit 1;; esac; done

confirm() {
  [ "$YES" = "1" ] && { echo "$1 [auto-yes]"; return 0; }
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
}
run() { if [ "$DRY" = "1" ]; then echo "[dry-run] $*"; else "$@"; fi; }

REGISTRY="0x41d7f4c434de83d1602c5a0bd548d1b985c8fff3"
LONG_ID="0x5f1c8f54170bee18d0d958454c78106f1271a5c6db6a2d607316e05f2ffc5d9d"
SHORT_ID="0xe88dfea8eff943c2c403ce19926864ad1cd688dd4b3bc55c74d82dfe0b0360d4"
SITE="https://levier-testnet.up.railway.app"

set -a
# shellcheck disable=SC1090
. <(grep -E "^(RPC_URL|PRIVATE_KEY)=" .env.testnet)
set +a
: "${RPC_URL:?}" "${PRIVATE_KEY:?}"
[ -n "${RPC_OVERRIDE:-}" ] && RPC_URL="$RPC_OVERRIDE"

echo "== Step 1/4: preflight =="
echo "Chain ID : $(cast chain-id --rpc-url "$RPC_URL")"
echo "Deployer : $(cast wallet address --private-key "$PRIVATE_KEY")"
status_of() { cast call "$REGISTRY" "markets(bytes32)(bytes32,string,address,address,address,address,uint8,uint8,uint256,uint256,uint256,uint256,uint256)" "$1" --rpc-url "$RPC_URL" | sed -n 8p | awk '{print $1}'; }
echo "Market status (0=NORMAL 1=REDUCE_ONLY 2=PAUSED): long=$(status_of "$LONG_ID") short=$(status_of "$SHORT_ID")"
if [ "$DRY" = "0" ]; then
  railway status >/dev/null 2>&1 || railway link -p levier -e testnet -s web >/dev/null
fi
confirm "Continue?"

echo "== Step 2/4: make sure markets are paused (the publisher activates them itself) =="
if [ "$(status_of "$LONG_ID")" != "2" ] || [ "$(status_of "$SHORT_ID")" != "2" ]; then
  confirm "A market is not paused. Run pnpm rh:markets:pause (BROADCASTS)?"
  run pnpm rh:markets:pause
else
  echo "Both markets paused, as the publisher requires."
fi
echo "Publisher budget: lowering per-transaction cap to 1e14 wei if still at 1e15 (the owner pause reserve check fails otherwise)."
run sed -i -E '/^RH_PUBLISHER_POLICY_JSON=/ s/"maxTransactionGasCostWei":"1000000000000000"/"maxTransactionGasCostWei":"100000000000000"/' .env.testnet

echo "== Step 3/4: Railway web variables + local apps/web/.env =="
MARKETS_JSON="$(node -e 'const {parseEnv}=require("node:util");const c=require("./apps/web/config/market-deployments.cjs");const e=parseEnv(require("fs").readFileSync("apps/web/.env","utf8"));const rows=c.marketDeploymentsSchema.parse(JSON.parse(e.MARKET_DEPLOYMENTS_JSON)).map(r=>({...r,enabled:true}));c.marketDeploymentsSchema.parse(rows);process.stdout.write(JSON.stringify(rows))')"
MARGIN_JSON="$(node -e 'const {parseEnv}=require("node:util");const e=parseEnv(require("fs").readFileSync("apps/web/.env","utf8"));process.stdout.write(e.MARGIN_DEPLOYMENT_JSON)')"
echo "Will set on Railway service 'web': MARKET_DEPLOYMENTS_JSON (TSLA enabled), MARGIN_DEPLOYMENT_JSON, MARGIN_TRADING_ENABLED=true, LENDING_ENABLED=true (TRADING_ENABLED stays false)"
confirm "Apply? This triggers a Railway rebuild."
run railway variables --service web \
  --set "MARKET_DEPLOYMENTS_JSON=$MARKETS_JSON" \
  --set "MARGIN_DEPLOYMENT_JSON=$MARGIN_JSON" \
  --set "MARGIN_TRADING_ENABLED=true" \
  --set "LENDING_ENABLED=true"
if [ "$DRY" = "0" ]; then
  node -e '
    const fs=require("fs");let s=fs.readFileSync("apps/web/.env","utf8");
    const rows=process.argv[1];
    s=s.replace(/^MARKET_DEPLOYMENTS_JSON=.*$/m,()=>"MARKET_DEPLOYMENTS_JSON=\x27"+rows+"\x27");
    s=s.replace(/^MARGIN_TRADING_ENABLED=.*$/m,"MARGIN_TRADING_ENABLED=\x27true\x27");
    s=s.replace(/^LENDING_ENABLED=.*$/m,"LENDING_ENABLED=\x27true\x27");
    fs.writeFileSync("apps/web/.env",s);' "$MARKETS_JSON"
  echo "apps/web/.env updated."
fi

echo "== Step 4/4: price publisher =="
echo "Railway is rebuilding. Wait for the deploy to finish (about 3-5 min), then open: $SITE/markets"
echo "Keep this terminal open: the publisher keeps oracle prices fresh. Ctrl+C to stop."
confirm "Start the price publisher now?"
run pnpm rh:publisher:serve
