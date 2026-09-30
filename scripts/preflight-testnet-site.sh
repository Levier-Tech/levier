#!/usr/bin/env bash
# Pre-flight check before testing or screen-recording the Levier testnet site. Read-only: sends no transactions.
# Usage: preflight-testnet-site.sh [wallet-address]   (default: the deployer wallet)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SITE="https://levier-testnet.up.railway.app"
set -a
# shellcheck disable=SC1090
. <(grep -E "^(RPC_URL|USDG_ADDRESS|DEPLOYER_ADDRESS)=" .env.testnet)
set +a
WALLET="${1:-$DEPLOYER_ADDRESS}"
ROUTER=0x2c7ca6d241c8b1573f83df764d921d3d97931a38
LONG_PAIR=0x43b3c72fa2e5b0b8ba8b610b7a39ce4c33ed38aa
SHORT_PAIR=0xa1c74a56ffecd1a472c86660696a7e92a8e87739
fail=0
ok()   { echo "  PASS  $1"; }
bad()  { echo "  FAIL  $1"; fail=$((fail+1)); }
warn() { echo "  WARN  $1"; }

echo "Pre-flight for wallet $WALLET"

code=$(curl -s -m 20 -o /dev/null -w "%{http_code}" "$SITE/trade?asset=TSLA"); [ "$code" = "200" ] && ok "site /trade responds (200)" || bad "site /trade returned $code"
code=$(curl -s -m 20 -o /dev/null -w "%{http_code}" "$SITE/lending"); [ "$code" = "200" ] && ok "site /lending responds (200)" || bad "site /lending returned $code"

analytics=$(curl -s -m 30 "$SITE/api/analytics")
verified=$(echo "$analytics" | python3 -c "import sys,json; print(json.load(sys.stdin)['totals']['verifiedMarkets'])" 2>/dev/null)
[ "$verified" = "2" ] && ok "site verifies both TSLA markets (long + short)" || bad "site verifiedMarkets=$verified (want 2)"

hist=$(curl -s -m 60 -o /dev/null -w "%{http_code}" "$SITE/api/margin/history?account=$WALLET&market=TSLA"); [ "$hist" = "200" ] && ok "trade history API works (200)" || bad "trade history API returned $hist"

paused=$(cast call "$ROUTER" "isPaused()(bool)" --rpc-url "$RPC_URL" 2>/dev/null); [ "$paused" = "false" ] && ok "router unpaused" || bad "router paused=$paused (start the publisher)"

health=.secrets/rh-live/publisher-health.json
if [ -f "$health" ]; then
  python3 - "$health" <<'PY'
import sys, json, datetime
h = json.load(open(sys.argv[1]))
now = datetime.datetime.now(datetime.timezone.utc)
exp = datetime.datetime.fromisoformat(h["expiresAt"].replace("Z", "+00:00"))
upd = datetime.datetime.fromisoformat(h["updatedAt"].replace("Z", "+00:00"))
left = int((exp - now).total_seconds() / 60)
age = int((now - upd).total_seconds())
print(f"  INFO  publisher status={h['status']} publications={h['publications']} failures={h['failures']} last update {age}s ago, run ends in {left} min")
sys.exit(0 if h["status"] == "healthy" and age < 180 else 1)
PY
  [ $? -eq 0 ] && ok "publisher healthy and fresh" || bad "publisher not healthy (run: levier testnet publisher)"
else bad "no publisher health file"; fi

usdg=$(cast call "$USDG_ADDRESS" "balanceOf(address)(uint256)" "$WALLET" --rpc-url "$RPC_URL" 2>/dev/null | awk '{print $1}')
eth=$(cast balance "$WALLET" --rpc-url "$RPC_URL" --ether 2>/dev/null)
python3 -c "import sys; sys.exit(0 if int('${usdg:-0}')>=10_000_000 else 1)" && ok "wallet USDG $(python3 -c "print(int('${usdg:-0}')/1e6)") (need >= 10)" || bad "wallet USDG too low (${usdg:-0} raw); get USDG at https://faucet.paxos.com/"
python3 -c "import sys; sys.exit(0 if float('${eth:-0}')>=0.002 else 1)" && ok "wallet ETH $eth (need >= 0.002)" || bad "wallet ETH too low ($eth)"

for pair in "$LONG_PAIR" "$SHORT_PAIR"; do
  acct=$(cast call "$pair" "accounts(address)(uint256,uint256)" "$WALLET" --rpc-url "$RPC_URL" 2>/dev/null | tr '\n' ' ' | awk '{print $1"/"$2}')
  case "$acct" in 0/0*|"0 [0]/0"*|*"[0]/0"*) ok "no open position on $pair" ;; *) warn "wallet has a position on $pair ($acct); close it before recording" ;; esac
done

k=$(curl -s -m 10 -o /dev/null -w "%{http_code}" --http1.1 -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" https://ws.kraken.com/v2)
[ "$k" = "101" ] && ok "Kraken websocket reachable (price feed)" || bad "Kraken websocket returned $k (rate-limited? wait and stop extra publishers)"

echo
if [ "$fail" -eq 0 ]; then echo "READY: $fail failures."; else echo "NOT READY: $fail failure(s)."; fi
exit $fail
