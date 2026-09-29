#!/usr/bin/env bash
# Interactive RH Testnet (chain 46630) deploy of the margin group for TSLA/USDG:
# UniswapV2Factory + pool (vendored bytecode), RhShortReferenceOracle, short LevierPair, MarginRouter.
# Then runs the funded long+short acceptance cycle. Resumable: the pipeline journals every tx in .secrets/rh-live.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ENV_FILE=".env.testnet"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE"; exit 1; }

confirm() {
  [ "${LEVIER_YES:-}" = "1" ] && { echo "$1 [auto-yes]"; return 0; }
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
}

# Testnet-sized plan. Deployer holds ~5 TSLA and ~95 USDG (USDG has 6 decimals, TSLA 18).
#   seed pool     : 40 USDG + equal-value TSLA (capped at 0.5 TSLA)
#   short liquidity: 1 TSLA sent to the short pair
#   acceptance     : 5 USDG margin per side
PLAN='{"version":1,"shortSlug":"levier-tsla-usdg-short-testnet","seedStableRaw":"40000000","maxSeedStockRaw":"500000000000000000","shortLiquidityRaw":"1000000000000000000","acceptanceMarginRaw":"5000000","shortSupplyCapRaw":"1000000000000000000000","shortBorrowCapRaw":"2000000000000000000","shortMaxLtvBps":6000,"shortLiquidationLtvBps":8000,"shortMaxLeverageBps":12500,"policy":{"maxMarginRaw":"10000000","slippageBps":50,"deadlineSeconds":120,"gasBufferBps":13000,"maxGasLimit":"1500000","longLeveragesBps":[12500,15000],"shortExposureBps":[10000,12500]}}'

echo "== Step 1/5: preflight =="
pnpm rh:margin:status || echo "(status failed before deploy is expected on a fresh run)"
confirm "Continue?"

echo "== Step 2/5: margin plan =="
if grep -q "^RH_MARGIN_PLAN_JSON=" "$ENV_FILE"; then
  echo "RH_MARGIN_PLAN_JSON already set in $ENV_FILE, keeping it."
else
  echo "$PLAN" | python3 -m json.tool
  confirm "Append this RH_MARGIN_PLAN_JSON to $ENV_FILE?"
  printf "RH_MARGIN_PLAN_JSON='%s'\n" "$PLAN" >> "$ENV_FILE"
fi

echo "== Step 3/5: deploy margin group (BROADCASTS on chain 46630) =="
confirm "Run pnpm deploy:rh-margin now?"
pnpm deploy:rh-margin

echo "== Step 4/5: funded long+short acceptance (BROADCASTS) =="
confirm "Run pnpm accept:rh-margin now?"
pnpm accept:rh-margin

echo "== Step 5/5: status =="
pnpm rh:margin:status
echo "Done. Next: record addresses in DEPLOYMENT_RECEIPT.md, then pnpm generate:lending-abis"
