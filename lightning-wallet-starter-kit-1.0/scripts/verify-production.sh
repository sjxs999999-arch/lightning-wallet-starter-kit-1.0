#!/bin/sh
set -u

CLIENT_ORIGIN=${CLIENT_ORIGIN:-https://lightingwallet.com}
ADMIN_ORIGIN=${ADMIN_ORIGIN:-https://admin.lightingwallet.com}
API_ORIGIN=${API_ORIGIN:-https://api.lightingwallet.com}
VERIFY_DIR=$(mktemp -d)
FAILURES_FILE=$VERIFY_DIR/failures
: > "$FAILURES_FILE"
trap 'rm -rf "$VERIFY_DIR"' EXIT HUP INT TERM

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  printf '%s\n' "$*" >> "$FAILURES_FILE"
  return 1
}

pass() { printf 'PASS: %s\n' "$*"; }

fetch() {
  name=$1
  url=$2
  status=$(curl --silent --show-error --location --max-time 20 --dump-header "$VERIFY_DIR/$name.headers" --output "$VERIFY_DIR/$name.body" --write-out '%{http_code}' "$url") || {
    fail "$name request failed"
    return 1
  }
  if [ "$status" != 200 ]; then
    fail "$name returned HTTP $status"
    return 1
  fi
}

header_contains() {
  file=$1
  header=$2
  value=$3
  label=$4
  if ! grep -i "^$header:" "$file" | grep -qi "$value"; then
    fail "$label: $header does not contain $value"
    return 1
  fi
}

if fetch client "$CLIENT_ORIGIN/wallets"; then
  header_contains "$VERIFY_DIR/client.headers" content-security-policy "frame-ancestors 'none'" 'client domain' || true
  header_contains "$VERIFY_DIR/client.headers" x-frame-options 'DENY' 'client domain' || true
  pass 'client domain is reachable'
fi

if fetch admin "$ADMIN_ORIGIN/login"; then
  header_contains "$VERIFY_DIR/admin.headers" content-security-policy "frame-ancestors 'none'" 'operator domain' || true
  header_contains "$VERIFY_DIR/admin.headers" x-frame-options 'DENY' 'operator domain' || true
  pass 'operator domain is reachable'
fi

if fetch flash "$CLIENT_ORIGIN/flashforge/"; then
  header_contains "$VERIFY_DIR/flash.headers" content-security-policy "frame-ancestors 'self'" 'FlashForge compatibility path' || true
  header_contains "$VERIFY_DIR/flash.headers" x-frame-options 'SAMEORIGIN' 'FlashForge compatibility path' || true
  pass 'FlashForge compatibility path is reachable'
fi

if fetch health "$API_ORIGIN/health"; then
  jq -e '.status == "ok" and .service == "lightning-api"' "$VERIFY_DIR/health.body" >/dev/null || fail 'API health payload is invalid' || true
fi
if fetch ready "$API_ORIGIN/health/ready"; then
  jq -e '.status == "ready" and .postgres == "ok" and .redis == "ok"' "$VERIFY_DIR/ready.body" >/dev/null || fail 'API readiness payload is invalid' || true
fi

if fetch capabilities "$API_ORIGIN/api/v1/system/capabilities"; then
  jq -e '.data.security.privateKeysUploaded == false and .data.security.serverSigning == false and .data.operator == "separate-admin-surface"' "$VERIFY_DIR/capabilities.body" >/dev/null || fail 'capability safety boundary is invalid' || true
fi
if fetch swap "$API_ORIGIN/api/v1/swap/status"; then
  jq -e '.data.privateKeyAccepted == false and .data.serverSigning == false and (.data.providers | length == 3)' "$VERIFY_DIR/swap.body" >/dev/null || fail 'Swap provider status is invalid' || true
fi

diagnostic_status=$(curl --silent --show-error --max-time 20 --output "$VERIFY_DIR/diagnostic.body" --write-out '%{http_code}' \
  -X POST "$API_ORIGIN/api/v1/errors/report" \
  -H "Origin: $CLIENT_ORIGIN" \
  -H 'Content-Type: application/json' \
  -H 'x-lightning-csrf: 1' \
  --data '{"name":"AcceptanceProbe","code":"RENDER_FAILURE","route":"/health-acceptance","fingerprint":"222222222222222222222222","release":"2.22.0"}') || diagnostic_status=000
if [ "$diagnostic_status" = 202 ] && jq -e '.data.accepted == true' "$VERIFY_DIR/diagnostic.body" >/dev/null; then
  pass 'anonymous metadata-only client diagnostic is accepted'
else
  fail "client diagnostic returned HTTP $diagnostic_status" || true
fi

diagnostic_read_status=$(curl --silent --show-error --max-time 20 --output "$VERIFY_DIR/diagnostic-read.body" --write-out '%{http_code}' "$API_ORIGIN/api/v1/errors/reports?limit=1") || diagnostic_read_status=000
if [ "$diagnostic_read_status" = 401 ]; then
  pass 'client diagnostic aggregates remain operator-only'
else
  fail "unauthenticated diagnostic read returned HTTP $diagnostic_read_status" || true
fi

for origin in "$CLIENT_ORIGIN" "$ADMIN_ORIGIN"; do
  name=$(printf '%s' "$origin" | tr -cd 'A-Za-z0-9')
  if curl --silent --show-error --max-time 20 --output /dev/null --dump-header "$VERIFY_DIR/cors-$name.headers" -H "Origin: $origin" "$API_ORIGIN/api/v1/chains"; then
    header_contains "$VERIFY_DIR/cors-$name.headers" access-control-allow-origin "$origin" "API CORS for $origin" || true
  else
    fail "CORS request failed for $origin" || true
  fi
done

if [ -s "$FAILURES_FILE" ]; then
  failure_count=$(wc -l < "$FAILURES_FILE" | tr -d ' ')
  printf '\nProduction acceptance failed with %s issue(s):\n' "$failure_count" >&2
  awk '{ printf "  %d. %s\n", NR, $0 }' "$FAILURES_FILE" >&2
  exit 1
fi

pass 'client and operator security headers'
pass 'FlashForge compatibility frame isolation'
pass 'API, PostgreSQL and Redis readiness'
pass 'public capability and Swap provider truthfulness'
pass 'privacy-safe client diagnostic write and operator-only read'
pass 'client and operator CORS allowlist'
printf '\nProduction HTTP acceptance passed.\n'
