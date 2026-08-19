#!/bin/sh
set -eu

CLIENT_ORIGIN=${CLIENT_ORIGIN:-https://lightingwallet.com}
ADMIN_ORIGIN=${ADMIN_ORIGIN:-https://admin.lightingwallet.com}
API_ORIGIN=${API_ORIGIN:-https://api.lightingwallet.com}
VERIFY_DIR=$(mktemp -d)
trap 'rm -rf "$VERIFY_DIR"' EXIT HUP INT TERM

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

fetch() {
  name=$1
  url=$2
  status=$(curl --fail-with-body --silent --show-error --location --max-time 20 --dump-header "$VERIFY_DIR/$name.headers" --output "$VERIFY_DIR/$name.body" --write-out '%{http_code}' "$url") || fail "$name request"
  [ "$status" = 200 ] || fail "$name returned HTTP $status"
}

header_contains() {
  file=$1
  header=$2
  value=$3
  grep -i "^$header:" "$file" | grep -qi "$value" || fail "$header does not contain $value"
}

fetch client "$CLIENT_ORIGIN/wallets"
header_contains "$VERIFY_DIR/client.headers" content-security-policy "frame-ancestors 'none'"
header_contains "$VERIFY_DIR/client.headers" x-frame-options 'DENY'
pass 'client domain and clickjacking protection'

fetch admin "$ADMIN_ORIGIN/login"
header_contains "$VERIFY_DIR/admin.headers" content-security-policy "frame-ancestors 'none'"
header_contains "$VERIFY_DIR/admin.headers" x-frame-options 'DENY'
pass 'operator domain and clickjacking protection'

fetch flash "$CLIENT_ORIGIN/flashforge/"
header_contains "$VERIFY_DIR/flash.headers" content-security-policy "frame-ancestors 'self'"
header_contains "$VERIFY_DIR/flash.headers" x-frame-options 'SAMEORIGIN'
pass 'FlashForge compatibility frame isolation'

fetch health "$API_ORIGIN/health"
jq -e '.status == "ok" and .service == "lightning-api"' "$VERIFY_DIR/health.body" >/dev/null || fail 'API health payload'
fetch ready "$API_ORIGIN/health/ready"
jq -e '.status == "ready" and .postgres == "ok" and .redis == "ok"' "$VERIFY_DIR/ready.body" >/dev/null || fail 'API readiness payload'
pass 'API, PostgreSQL and Redis readiness'

fetch capabilities "$API_ORIGIN/api/v1/system/capabilities"
jq -e '.data.security.privateKeysUploaded == false and .data.security.serverSigning == false and .data.operator == "separate-admin-surface"' "$VERIFY_DIR/capabilities.body" >/dev/null || fail 'capability safety boundary'
fetch swap "$API_ORIGIN/api/v1/swap/status"
jq -e '.data.privateKeyAccepted == false and .data.serverSigning == false and (.data.providers | length == 3)' "$VERIFY_DIR/swap.body" >/dev/null || fail 'Swap provider status'
pass 'public capability and Swap provider truthfulness'

for origin in "$CLIENT_ORIGIN" "$ADMIN_ORIGIN"; do
  name=$(printf '%s' "$origin" | tr -cd 'A-Za-z0-9')
  curl --silent --show-error --max-time 20 --output /dev/null --dump-header "$VERIFY_DIR/cors-$name.headers" -H "Origin: $origin" "$API_ORIGIN/api/v1/chains" || fail "CORS request for $origin"
  header_contains "$VERIFY_DIR/cors-$name.headers" access-control-allow-origin "$origin"
done
pass 'client and operator CORS allowlist'

echo 'Production HTTP acceptance passed.'
