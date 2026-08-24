#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
VALID_FIXTURE=$SCRIPT_DIR/fixtures/production-env.valid.test
EXAMPLE_FILE=$SCRIPT_DIR/../.env.production.example
LIVE_ACCEPTANCE_MOCK=$SCRIPT_DIR/fixtures/mock-wallet-acceptance-live-curl.sh

sh -n "$SCRIPT_DIR/check-deploy-disk.sh" "$SCRIPT_DIR/check-production-env.sh" "$SCRIPT_DIR/deploy.sh" "$SCRIPT_DIR/promote-release.sh" "$SCRIPT_DIR/rollback-release.sh" "$SCRIPT_DIR/verify-production.sh" "$SCRIPT_DIR/verify-final-readiness.sh" "$SCRIPT_DIR/verify-live-providers.sh" "$SCRIPT_DIR/verify-wallet-acceptance.sh" "$SCRIPT_DIR/verify-wallet-acceptance-live.sh" "$SCRIPT_DIR/test-deploy-disk.sh" "$SCRIPT_DIR/test-promote-release.sh" "$SCRIPT_DIR/test-verification-gates.sh" "$SCRIPT_DIR/test-wallet-acceptance.sh"
PRODUCTION_ENV_FILE="$VALID_FIXTURE" "$SCRIPT_DIR/check-production-env.sh"

mainnet_fixture=$(mktemp)
bridge_fixture=$(mktemp)
swap_fixture=$(mktemp)
accepted_fixture=$(mktemp)
bad_acceptance_fixture=$(mktemp)
production_acceptance_report=$(mktemp)
trap 'rm -f "$mainnet_fixture" "$bridge_fixture" "$swap_fixture" "$accepted_fixture" "$bad_acceptance_fixture" "$production_acceptance_report"' EXIT
sed 's/^VITE_ENABLE_MAINNET_LAUNCHPAD=false$/VITE_ENABLE_MAINNET_LAUNCHPAD=true/' "$VALID_FIXTURE" > "$mainnet_fixture"
if STRICT_EXTERNAL_PROVIDERS=true PRODUCTION_ENV_FILE="$mainnet_fixture" "$SCRIPT_DIR/check-production-env.sh"; then
  echo 'Launchpad mainnet gate unexpectedly accepted without the global mainnet switch.' >&2
  exit 1
fi

sed 's/^VITE_ENABLE_MAINNET_SWAP=false$/VITE_ENABLE_MAINNET_SWAP=true/' "$VALID_FIXTURE" > "$swap_fixture"
if STRICT_EXTERNAL_PROVIDERS=true PRODUCTION_ENV_FILE="$swap_fixture" "$SCRIPT_DIR/check-production-env.sh"; then
  echo 'Swap mainnet gate unexpectedly accepted without the global mainnet switch.' >&2
  exit 1
fi

sed 's/^VITE_ENABLE_MAINNET_BRIDGE=false$/VITE_ENABLE_MAINNET_BRIDGE=true/' "$VALID_FIXTURE" > "$bridge_fixture"
if STRICT_EXTERNAL_PROVIDERS=true PRODUCTION_ENV_FILE="$bridge_fixture" "$SCRIPT_DIR/check-production-env.sh"; then
  echo 'Bridge mainnet gate unexpectedly accepted without the global mainnet switch.' >&2
  exit 1
fi

if STRICT_EXTERNAL_PROVIDERS=true PRODUCTION_ENV_FILE="$VALID_FIXTURE" "$SCRIPT_DIR/check-production-env.sh"; then
  echo 'Strict provider gate unexpectedly accepted missing providers.' >&2
  exit 1
fi

jq --arg approvedAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" '
  .environment = "production" |
  .approvedBy = "release-operator@acceptance.invalid" |
  .approvedAt = $approvedAt
' "$SCRIPT_DIR/fixtures/wallet-acceptance.valid.test.json" > "$production_acceptance_report"
ACCEPTANCE_REPORT=$production_acceptance_report
if command -v sha256sum >/dev/null 2>&1; then
  ACCEPTANCE_SHA=$(sha256sum "$ACCEPTANCE_REPORT" | awk '{print $1}')
else
  ACCEPTANCE_SHA=$(shasum -a 256 "$ACCEPTANCE_REPORT" | awk '{print $1}')
fi
sed -e 's/^VITE_MAINNET_EXECUTION_ENABLED=false$/VITE_MAINNET_EXECUTION_ENABLED=true/' \
  -e 's/^VITE_ENABLE_MAINNET_SWAP=false$/VITE_ENABLE_MAINNET_SWAP=true/' \
  -e 's/^VITE_ENABLE_MAINNET_LAUNCHPAD=false$/VITE_ENABLE_MAINNET_LAUNCHPAD=true/' \
  -e 's/^VITE_ENABLE_MAINNET_BRIDGE=false$/VITE_ENABLE_MAINNET_BRIDGE=true/' \
  -e 's/^FINAL_WALLET_ACCEPTANCE_APPROVED=false$/FINAL_WALLET_ACCEPTANCE_APPROVED=true/' \
  "$VALID_FIXTURE" > "$accepted_fixture"
printf '%s\n' \
  'VITE_WALLETCONNECT_PROJECT_ID=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  'GASFREE_PROVIDER_URL=https://paymaster.test.invalid' \
  'MARKET_HOLDER_PROVIDER_URL=https://holders.test.invalid' \
  'FLASH_LOAN_URL=https://flash.test.invalid' \
  'FLASH_LOAN_API_URL=https://flash.test.invalid/api' \
  'FLASH_LOAN_PROVIDER_APPROVED=true' \
  'AUTOMATION_ENABLE_DELIVERY=true' \
  'WEBHOOK_SIGNING_SECRET=test-webhook-signing-secret-with-32-characters' \
  "FINAL_WALLET_ACCEPTANCE_REPORT=$ACCEPTANCE_REPORT" \
  "FINAL_WALLET_ACCEPTANCE_EVIDENCE_SHA256=$ACCEPTANCE_SHA" >> "$accepted_fixture"
CURL_BIN="$LIVE_ACCEPTANCE_MOCK" STRICT_EXTERNAL_PROVIDERS=true PRODUCTION_ENV_FILE="$accepted_fixture" "$SCRIPT_DIR/check-production-env.sh"

sed "s/^FINAL_WALLET_ACCEPTANCE_EVIDENCE_SHA256=.*/FINAL_WALLET_ACCEPTANCE_EVIDENCE_SHA256=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/" "$accepted_fixture" > "$bad_acceptance_fixture"
if CURL_BIN="$LIVE_ACCEPTANCE_MOCK" STRICT_EXTERNAL_PROVIDERS=true PRODUCTION_ENV_FILE="$bad_acceptance_fixture" "$SCRIPT_DIR/check-production-env.sh"; then
  echo 'Production gate unexpectedly accepted mismatched wallet evidence.' >&2
  exit 1
fi

if PRODUCTION_ENV_FILE="$EXAMPLE_FILE" "$SCRIPT_DIR/check-production-env.sh"; then
  echo 'Production example unexpectedly passed with placeholder credentials.' >&2
  exit 1
fi

echo 'Production environment gate tests passed.'
