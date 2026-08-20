#!/usr/bin/env sh
set -eu

API_ORIGIN=${API_ORIGIN:-https://api.lightingwallet.com}
CLIENT_ORIGIN=${CLIENT_ORIGIN:-https://lightingwallet.com}
CURL_BIN=${CURL_BIN:-curl}
JQ_BIN=${JQ_BIN:-jq}
TRON_NATIVE=${TRON_NATIVE:-T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb}
TRON_USDT=${TRON_USDT:-TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t}
TRON_TAKER=${TRON_TAKER:-T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb}
SELL_AMOUNT=${SELL_AMOUNT:-1000000}
SLIPPAGE_BPS=${SLIPPAGE_BPS:-50}

case "$API_ORIGIN" in https://*) : ;; *) echo 'API_ORIGIN must use HTTPS.' >&2; exit 2 ;; esac
case "$CLIENT_ORIGIN" in https://*) : ;; *) echo 'CLIENT_ORIGIN must use HTTPS.' >&2; exit 2 ;; esac
case "$SELL_AMOUNT" in ''|*[!0-9]*) echo 'SELL_AMOUNT must be a positive raw integer.' >&2; exit 2 ;; esac
test "$SELL_AMOUNT" -gt 0 || { echo 'SELL_AMOUNT must be greater than zero.' >&2; exit 2; }
case "$SLIPPAGE_BPS" in ''|*[!0-9]*) echo 'SLIPPAGE_BPS must be an integer from 1 to 500.' >&2; exit 2 ;; esac
test "$SLIPPAGE_BPS" -ge 1 && test "$SLIPPAGE_BPS" -le 500 || { echo 'SLIPPAGE_BPS must be from 1 to 500.' >&2; exit 2; }

command -v "$CURL_BIN" >/dev/null 2>&1 || { echo 'curl is required.' >&2; exit 1; }
command -v "$JQ_BIN" >/dev/null 2>&1 || { echo 'jq is required.' >&2; exit 1; }

VERIFY_DIR=$(mktemp -d)
trap 'rm -rf "$VERIFY_DIR"' EXIT HUP INT TERM
BODY=$VERIFY_DIR/body.json
HEADERS=$VERIFY_DIR/headers.txt
META=$VERIFY_DIR/meta.txt

payload=$("$JQ_BIN" -cn \
  --arg sellToken "$TRON_NATIVE" \
  --arg buyToken "$TRON_USDT" \
  --arg sellAmount "$SELL_AMOUNT" \
  --arg taker "$TRON_TAKER" \
  --argjson slippageBps "$SLIPPAGE_BPS" \
  '{chain:"TRON",sellToken:$sellToken,buyToken:$buyToken,sellAmount:$sellAmount,taker:$taker,slippageBps:$slippageBps}')

"$CURL_BIN" --silent --show-error --max-time 20 \
  --output "$BODY" --dump-header "$HEADERS" --write-out '%{http_code} %{time_total}' \
  -X POST "$API_ORIGIN/api/v1/swap/quotes" \
  -H "Origin: $CLIENT_ORIGIN" \
  -H 'Content-Type: application/json' \
  -H 'x-lightning-csrf: 1' \
  --data "$payload" > "$META"

set -- $(cat "$META")
status=${1:-}
elapsed=${2:-}
test "$status" = 200 || {
  error=$("$JQ_BIN" -r '.error // .message // "unknown response"' "$BODY" 2>/dev/null || echo 'invalid response')
  echo "Live SUN.io verification failed with HTTP $status: $error" >&2
  exit 1
}

grep -i '^access-control-allow-origin:' "$HEADERS" | grep -Fq "$CLIENT_ORIGIN" || {
  echo 'Live SUN.io response did not preserve the client CORS allowlist.' >&2
  exit 1
}

"$JQ_BIN" -e \
  --arg amount "$SELL_AMOUNT" \
  --arg sell "$TRON_NATIVE" \
  --arg buy "$TRON_USDT" '
  (.data | type == "array") and
  (.data | length > 0) and
  ([.data[] |
    .provider == "SUN.io Smart Router" and
    .amountIn == $amount and
    (.amountOut | type == "string" and test("^[0-9]+$") and . != "0") and
    (.minReceived | type == "string" and test("^[0-9]+$")) and
    (.priceImpactPct | type == "number" and . >= 0 and . <= 100) and
    .raw.network == "mainnet" and
    .raw.verifiedHooksOnly == true and
    .raw.sunRoute.containsUnverifiedHook == false and
    .raw.sunRoute.tokens[0] == $sell and
    .raw.sunRoute.tokens[-1] == $buy and
    (.raw.sunRoute.poolVersions | type == "array" and length > 0)
  ] | all) and
  ([.. | objects | keys[] | ascii_downcase] |
    any(. == "privatekey" or . == "mnemonic" or . == "secretkey" or . == "seedphrase") | not)
  ' "$BODY" >/dev/null || {
  echo 'Live SUN.io response failed the strict public-route validation.' >&2
  exit 1
}

candidate_count=$("$JQ_BIN" -r '.data | length' "$BODY")
printf 'PASS: production SUN.io returned %s verified public route(s) in %ss. No wallet, signature or broadcast was requested.\n' "$candidate_count" "$elapsed"
