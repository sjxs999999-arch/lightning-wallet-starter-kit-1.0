#!/bin/sh
set -eu

STAGE=${1:-${RELEASE_STAGE:-}}
API_ORIGIN=${API_ORIGIN:-https://api.lightingwallet.com}
CURL_BIN=${CURL_BIN:-curl}
VERIFY_DIR=$(mktemp -d)
trap 'rm -rf "$VERIFY_DIR"' EXIT HUP INT TERM

case "$STAGE" in
  internal|public) : ;;
  *) echo 'Runtime-provider stage must be internal or public.' >&2; exit 2 ;;
esac
case "$API_ORIGIN" in https://*) : ;; *) echo 'API_ORIGIN must use HTTPS.' >&2; exit 2 ;; esac
command -v "$CURL_BIN" >/dev/null 2>&1 || { echo 'curl is required.' >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo 'jq is required.' >&2; exit 2; }

fetch_json() {
  name=$1
  path=$2
  status=$($CURL_BIN --silent --show-error --location --max-time 20 \
    --output "$VERIFY_DIR/$name.json" --write-out '%{http_code}' "$API_ORIGIN$path") || {
    printf 'Runtime-provider verification failed: %s request failed.\n' "$name" >&2
    exit 1
  }
  [ "$status" = 200 ] || {
    printf 'Runtime-provider verification failed: %s returned HTTP %s.\n' "$name" "$status" >&2
    exit 1
  }
  jq -e . "$VERIFY_DIR/$name.json" >/dev/null || {
    printf 'Runtime-provider verification failed: %s returned invalid JSON.\n' "$name" >&2
    exit 1
  }
}

fetch_json flash-loan /api/v1/integrations/flash-loan/health
if [ "$STAGE" = public ]; then
  jq -e '.data.status == "ready" and .data.mainnetEnabled == true' "$VERIFY_DIR/flash-loan.json" >/dev/null || {
    echo 'Public beta is blocked: Flash Loan is not a live mainnet-enabled integration.' >&2
    exit 1
  }
else
  jq -e '.data.status == "ready" and (.data.mainnetEnabled | type) == "boolean" and (.data.network | type == "string" and length > 0)' "$VERIFY_DIR/flash-loan.json" >/dev/null || {
    echo 'Internal beta is blocked: Flash Loan runtime/preflight is not ready.' >&2
    exit 1
  }
fi
printf 'PASS [flash-loan-runtime]: %s readiness is explicit.\n' "$STAGE"

fetch_json gasfree /api/v1/gasfree/status
if [ "$STAGE" = public ]; then
  jq -e '
    .data.configured == true and .data.status == "ready" and .data.mainnetEnabled == true and
    (.data.capabilities | type == "array" and index("sponsor") != null and index("paymaster") != null)
  ' "$VERIFY_DIR/gasfree.json" >/dev/null || {
    echo 'Public beta is blocked: GasFree is not a live mainnet-enabled paymaster integration.' >&2
    exit 1
  }
else
  jq -e '
    .data.configured == true and .data.status == "ready" and (.data.mainnetEnabled | type) == "boolean" and
    (.data.capabilities | type == "array" and index("sponsor") != null and index("paymaster") != null)
  ' "$VERIFY_DIR/gasfree.json" >/dev/null || {
    echo 'Internal beta is blocked: GasFree paymaster runtime is not ready.' >&2
    exit 1
  }
fi
printf 'PASS [gasfree-runtime]: %s readiness is explicit.\n' "$STAGE"
