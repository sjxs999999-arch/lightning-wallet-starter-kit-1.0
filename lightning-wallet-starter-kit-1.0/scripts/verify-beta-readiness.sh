#!/bin/sh
set -eu

STAGE=${1:-${RELEASE_STAGE:-}}
REPORT=${2:-${RELEASE_ACCEPTANCE_REPORT:-}}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
API_ORIGIN=${API_ORIGIN:-https://api.lightingwallet.com}
CLIENT_ORIGIN=${CLIENT_ORIGIN:-https://lightingwallet.com}
ADMIN_ORIGIN=${ADMIN_ORIGIN:-https://admin.lightingwallet.com}
EXPECTED_RELEASE=${EXPECTED_RELEASE:-2.40.0}
CURL_BIN=${CURL_BIN:-$(command -v curl || true)}

case "$STAGE" in
  internal|public) : ;;
  *) echo 'Beta readiness stage must be internal or public.' >&2; exit 2 ;;
esac
[ -n "$REPORT" ] || { echo 'Release acceptance report path is required.' >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo 'jq is required.' >&2; exit 2; }
[ -n "$CURL_BIN" ] || { echo 'curl is required.' >&2; exit 2; }

run() {
  label=$1
  shift
  printf '\n== %s ==\n' "$label"
  "$@"
  printf 'PASS [%s]\n' "$label"
}

cd "$PROJECT_DIR"

if [ -n "$(git status --porcelain)" ]; then
  echo 'Beta readiness is blocked: the release checkout is not clean and committed.' >&2
  exit 1
fi

report_commit=$(jq -r '.code.commit // empty' "$REPORT")
current_commit=$(git rev-parse HEAD)
[ "$report_commit" = "$current_commit" ] || {
  printf 'Beta readiness is blocked: evidence commit %s does not match checkout %s.\n' "${report_commit:-missing}" "$current_commit" >&2
  exit 1
}

run 'evidence-schema' env EXPECTED_RELEASE="$EXPECTED_RELEASE" EXPECTED_ACCEPTANCE_ENVIRONMENT=production "$SCRIPT_DIR/verify-release-evidence.sh" "$STAGE" "$REPORT"
run 'lint' npm run lint
run 'typecheck' npm run typecheck
run 'tests' npm test
run 'build' npm run build
run 'secret-scan' "$SCRIPT_DIR/check-secrets.sh"
run 'production-http' env CLIENT_ORIGIN="$CLIENT_ORIGIN" ADMIN_ORIGIN="$ADMIN_ORIGIN" API_ORIGIN="$API_ORIGIN" EXPECTED_RELEASE="$EXPECTED_RELEASE" EXPECTED_COMMIT="$current_commit" "$SCRIPT_DIR/verify-production.sh"

capabilities=$(mktemp)
trap 'rm -f "$capabilities"' EXIT HUP INT TERM
status=$($CURL_BIN --silent --show-error --location --max-time 20 --output "$capabilities" --write-out '%{http_code}' "$API_ORIGIN/api/v1/system/capabilities") || {
  echo 'Beta readiness is blocked: capability request failed.' >&2
  exit 1
}
[ "$status" = 200 ] || { printf 'Beta readiness is blocked: capability endpoint returned HTTP %s.\n' "$status" >&2; exit 1; }

if ! jq -e --arg release "$EXPECTED_RELEASE" '
  .data.version == $release and
  (.data.readiness.externalBlockers | length) == 0 and
  all(.data.features[];
    .status != "provider-required" and
    .status != "real-app-required" and
    .status != "delivery-provider-required" and
    .status != "partial-provider-configuration") and
  .data.security.privateKeysUploaded == false and
  .data.security.serverSigning == false and
  .data.security.serverBroadcast == false
' "$capabilities" >/dev/null; then
  echo 'Beta readiness is blocked: one or more real providers are absent or the capability safety contract is invalid.' >&2
  jq '{externalBlockers:.data.readiness.externalBlockers,gatedFeatures:[.data.features[]|select(.status!="ready")|{name,status}]}' "$capabilities" >&2
  exit 1
fi
echo 'PASS [provider-configuration]: all required external providers are configured without enabling server custody.'

run 'live-public-quotes' env CURL_BIN="$CURL_BIN" JQ_BIN=jq CLIENT_ORIGIN="$CLIENT_ORIGIN" API_ORIGIN="$API_ORIGIN" "$SCRIPT_DIR/verify-live-providers.sh"
run 'runtime-providers' env CURL_BIN="$CURL_BIN" API_ORIGIN="$API_ORIGIN" "$SCRIPT_DIR/verify-runtime-providers.sh" "$STAGE"

if [ "$STAGE" = internal ]; then
  echo
  echo 'INTERNAL BETA READY: committed code, production runtime, providers, wallet connection and simulations passed. Signing/broadcast remain a separate public gate.'
  exit 0
fi

[ -n "${FINAL_WALLET_ACCEPTANCE_REPORT:-}" ] || {
  echo 'Public beta is blocked: FINAL_WALLET_ACCEPTANCE_REPORT is required.' >&2
  exit 1
}

evidence_sha=$(jq -r '.walletAcceptance.reportSha256' "$REPORT")
run 'wallet-evidence' env EXPECTED_RELEASE="$EXPECTED_RELEASE" EXPECTED_ACCEPTANCE_ENVIRONMENT=production FINAL_WALLET_ACCEPTANCE_EVIDENCE_SHA256="$evidence_sha" "$SCRIPT_DIR/verify-wallet-acceptance.sh" "$FINAL_WALLET_ACCEPTANCE_REPORT"
run 'feature-to-wallet-evidence-link' "$SCRIPT_DIR/verify-release-wallet-links.sh" "$REPORT" "$FINAL_WALLET_ACCEPTANCE_REPORT"
run 'wallet-public-chain-confirmation' env \
  CURL_BIN="$CURL_BIN" \
  WALLET_ACCEPTANCE_SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com \
  WALLET_ACCEPTANCE_SOLANA_DEVNET_RPC_URL=https://api.devnet.solana.com \
  WALLET_ACCEPTANCE_TRON_NILE_RPC_URL=https://nile.trongrid.io \
  WALLET_ACCEPTANCE_MAX_AGE_SECONDS=2592000 \
  EXPECTED_RELEASE="$EXPECTED_RELEASE" \
  EXPECTED_ACCEPTANCE_ENVIRONMENT=production \
  "$SCRIPT_DIR/verify-wallet-acceptance-live.sh" "$FINAL_WALLET_ACCEPTANCE_REPORT"

intent_verifier=${FEATURE_INTENT_VERIFIER:-}
intent_verifier_approved_sha=${FEATURE_INTENT_VERIFIER_APPROVED_SHA256:-}
[ -n "$intent_verifier" ] || {
  echo 'Public beta is blocked: FEATURE_INTENT_VERIFIER is required for independent on-chain intent decoding.' >&2
  exit 1
}
[ -f "$intent_verifier" ] && [ -x "$intent_verifier" ] || {
  echo 'Public beta is blocked: FEATURE_INTENT_VERIFIER must be an executable regular file.' >&2
  exit 1
}
case "$intent_verifier_approved_sha" in
  ''|*[!0-9a-fA-F]*) echo 'Public beta is blocked: FEATURE_INTENT_VERIFIER_APPROVED_SHA256 must be a 64-character SHA-256 digest.' >&2; exit 1 ;;
esac
[ "${#intent_verifier_approved_sha}" -eq 64 ] || {
  echo 'Public beta is blocked: FEATURE_INTENT_VERIFIER_APPROVED_SHA256 must be a 64-character SHA-256 digest.' >&2
  exit 1
}
intent_verifier_approved_sha=$(printf '%s' "$intent_verifier_approved_sha" | tr 'A-F' 'a-f')
if command -v sha256sum >/dev/null 2>&1; then
  intent_verifier_actual_sha=$(sha256sum "$intent_verifier" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  intent_verifier_actual_sha=$(shasum -a 256 "$intent_verifier" | awk '{print $1}')
else
  echo 'Public beta is blocked: a SHA-256 utility is required to pin the intent verifier.' >&2
  exit 1
fi
[ "$intent_verifier_actual_sha" = "$intent_verifier_approved_sha" ] || {
  echo 'Public beta is blocked: the independent intent verifier does not match its approved SHA-256.' >&2
  exit 1
}

if command -v sha256sum >/dev/null 2>&1; then
  wallet_report_sha=$(sha256sum "$FINAL_WALLET_ACCEPTANCE_REPORT" | awk '{print $1}')
else
  wallet_report_sha=$(shasum -a 256 "$FINAL_WALLET_ACCEPTANCE_REPORT" | awk '{print $1}')
fi
intent_result=$(mktemp)
trap 'rm -f "$capabilities" "$intent_result"' EXIT HUP INT TERM
if ! EXPECTED_RELEASE="$EXPECTED_RELEASE" EXPECTED_COMMIT="$current_commit" \
  "$intent_verifier" "$FINAL_WALLET_ACCEPTANCE_REPORT" > "$intent_result"; then
  echo 'Public beta is blocked: the independent on-chain intent decoder rejected the wallet evidence.' >&2
  exit 1
fi
if ! jq -e \
  --arg release "$EXPECTED_RELEASE" \
  --arg commit "$current_commit" \
  --arg walletSha "$wallet_report_sha" '
    .format == "lightning-wallet-intent-verification-v1" and
    .release == $release and
    .commit == $commit and
    .walletAcceptanceSha256 == $walletSha and
    .mode == "independent-chain-decoder" and
    .intentSource == "on-chain-transaction-payload" and
    .verified == true and
    .verifiedTransactions == 8
  ' "$intent_result" >/dev/null; then
  echo 'Public beta is blocked: the intent decoder result is missing exact release, commit, report digest or decoded-transaction evidence.' >&2
  exit 1
fi
echo 'PASS [independent-on-chain-intent-decoder]: eight feature transactions were decoded and matched to the pinned wallet report.'

run 'final-readiness' env API_ORIGIN="$API_ORIGIN" EXPECTED_RELEASE="$EXPECTED_RELEASE" "$SCRIPT_DIR/verify-final-readiness.sh"

echo
echo 'PUBLIC BETA READY: code, providers, wallets, simulations, user signatures, public-chain broadcasts and final mainnet gates all passed.'
