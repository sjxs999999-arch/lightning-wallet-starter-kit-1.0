#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
VALID=$SCRIPT_DIR/fixtures/wallet-acceptance.valid.test.json
TEMPLATE=$SCRIPT_DIR/fixtures/wallet-acceptance.template.json
LIVE_MOCK=$SCRIPT_DIR/fixtures/mock-wallet-acceptance-live-curl.sh
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT HUP INT TERM

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

valid_sha=$(sha256_file "$VALID")
EXPECTED_ACCEPTANCE_ENVIRONMENT=test FINAL_WALLET_ACCEPTANCE_EVIDENCE_SHA256="$valid_sha" "$SCRIPT_DIR/verify-wallet-acceptance.sh" "$VALID"

jq --arg approvedAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" '.approvedAt = $approvedAt' "$VALID" > "$TEST_DIR/live.json"
CURL_BIN="$LIVE_MOCK" EXPECTED_ACCEPTANCE_ENVIRONMENT=test "$SCRIPT_DIR/verify-wallet-acceptance-live.sh" "$TEST_DIR/live.json"

jq '.approvedAt = "2020-01-01T00:00:00Z"' "$VALID" > "$TEST_DIR/stale.json"
if CURL_BIN="$LIVE_MOCK" EXPECTED_ACCEPTANCE_ENVIRONMENT=test "$SCRIPT_DIR/verify-wallet-acceptance-live.sh" "$TEST_DIR/stale.json"; then
  echo 'Live wallet acceptance verifier unexpectedly accepted stale evidence.' >&2
  exit 1
fi

jq '.approvedAt = "2999-01-01T00:00:00Z"' "$VALID" > "$TEST_DIR/future.json"
if CURL_BIN="$LIVE_MOCK" EXPECTED_ACCEPTANCE_ENVIRONMENT=test "$SCRIPT_DIR/verify-wallet-acceptance-live.sh" "$TEST_DIR/future.json"; then
  echo 'Live wallet acceptance verifier unexpectedly accepted future evidence.' >&2
  exit 1
fi

for failure in evm-chain evm solana-chain solana tron; do
  if MOCK_WALLET_ACCEPTANCE_FAILURE="$failure" CURL_BIN="$LIVE_MOCK" EXPECTED_ACCEPTANCE_ENVIRONMENT=test "$SCRIPT_DIR/verify-wallet-acceptance-live.sh" "$TEST_DIR/live.json"; then
    echo "Live wallet acceptance verifier unexpectedly accepted $failure evidence." >&2
    exit 1
  fi
done

if EXPECTED_ACCEPTANCE_ENVIRONMENT=production "$SCRIPT_DIR/verify-wallet-acceptance.sh" "$TEMPLATE"; then
  echo 'Pending wallet acceptance template unexpectedly passed.' >&2
  exit 1
fi

if EXPECTED_ACCEPTANCE_ENVIRONMENT=test FINAL_WALLET_ACCEPTANCE_EVIDENCE_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$SCRIPT_DIR/verify-wallet-acceptance.sh" "$VALID"; then
  echo 'Wallet acceptance verifier unexpectedly accepted a mismatched digest.' >&2
  exit 1
fi

echo 'Wallet acceptance offline and public-chain evidence tests passed.'
