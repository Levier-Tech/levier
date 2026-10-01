#!/usr/bin/env bash
# Adds and opens one more mainnet market in one interactive run, e.g.
#   bash scripts/add-rh-mainnet-market.sh NVDA
# 1. deploy the market contracts (closed), 2. buy its opening tokens with the deployer's ETH,
# 3. open it at micro size. Every stage is rehearsed on a fork first and journaled, so a re-run resumes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SYMBOL="$(printf '%s' "${1:-}" | tr 'a-z' 'A-Z')"
[[ "$SYMBOL" =~ ^[A-Z]{1,8}$ ]] || { echo "Usage: bash scripts/add-rh-mainnet-market.sh <SYMBOL>"; exit 1; }
LOWER="$(printf '%s' "$SYMBOL" | tr 'A-Z' 'a-z')"
ENV_FILE=".env.mainnet.core.local"
FLAGS="MAINNET_ADD_BROADCAST_ENABLED MAINNET_SWAP_BROADCAST_ENABLED MAINNET_ENABLE_BROADCAST_ENABLED"
for flag in $FLAGS; do
  grep -q "^$flag=" "$ENV_FILE" || printf '\n%s=false\n' "$flag" >> "$ENV_FILE"
done
set_flag() { sed -i "s/^$1=.*/$1=$2/" "$ENV_FILE"; }
all_off() { for flag in $FLAGS; do set_flag "$flag" false; done; }
trap all_off EXIT
all_off
export MAINNET_ADD_MARKET="$SYMBOL" MAINNET_BUY_MARKETS="$SYMBOL" MAINNET_ENABLE_MARKETS="$SYMBOL"

echo "== Stage 1/3: deploy the $SYMBOL market contracts (stays closed) =="
if [ -f ".secrets/rh-mainnet-add-$LOWER/state.json" ]; then
  echo "Journal found, resuming."
else
  node scripts/add-rh-mainnet-market.mjs --plan
fi
read -r -p "Rehearsal above passed. Type ADD $SYMBOL to broadcast stages 1-3 to MAINNET (real ETH): " phrase
[ "$phrase" = "ADD $SYMBOL" ] || { echo "Aborted."; exit 1; }
set_flag MAINNET_ADD_BROADCAST_ENABLED true
node scripts/add-rh-mainnet-market.mjs --run
set_flag MAINNET_ADD_BROADCAST_ENABLED false
node scripts/add-rh-mainnet-market.mjs --verify

echo "== Stage 2/3: buy the $SYMBOL opening tokens =="
node scripts/buy-mainnet-market-tokens.mjs --plan
set_flag MAINNET_SWAP_BROADCAST_ENABLED true
node scripts/buy-mainnet-market-tokens.mjs --run
set_flag MAINNET_SWAP_BROADCAST_ENABLED false

echo "== Stage 3/3: open the $SYMBOL market (micro size) =="
if [ ! -f ".secrets/rh-mainnet-enable-$LOWER/state.json" ]; then
  node scripts/enable-rh-mainnet-markets.mjs --plan
fi
set_flag MAINNET_ENABLE_BROADCAST_ENABLED true
node scripts/enable-rh-mainnet-markets.mjs --run
set_flag MAINNET_ENABLE_BROADCAST_ENABLED false
node scripts/enable-rh-mainnet-markets.mjs --verify
echo "$SYMBOL market is open on-chain. Tell Claude: \"$LOWER open\"."
