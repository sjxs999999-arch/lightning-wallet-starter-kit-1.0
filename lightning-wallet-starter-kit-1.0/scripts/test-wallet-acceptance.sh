#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
VALID=$SCRIPT_DIR/fixtures/wallet-acceptance.valid.test.json
TEMPLATE=$SCRIPT_DIR/fixtures/wallet-acceptance.template.json

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

valid_sha=$(sha256_file "$VALID")
EXPECTED_ACCEPTANCE_ENVIRONMENT=test FINAL_WALLET_ACCEPTANCE_EVIDENCE_SHA256="$valid_sha" "$SCRIPT_DIR/verify-wallet-acceptance.sh" "$VALID"

if EXPECTED_ACCEPTANCE_ENVIRONMENT=production "$SCRIPT_DIR/verify-wallet-acceptance.sh" "$TEMPLATE"; then
  echo 'Pending wallet acceptance template unexpectedly passed.' >&2
  exit 1
fi

if EXPECTED_ACCEPTANCE_ENVIRONMENT=test FINAL_WALLET_ACCEPTANCE_EVIDENCE_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$SCRIPT_DIR/verify-wallet-acceptance.sh" "$VALID"; then
  echo 'Wallet acceptance verifier unexpectedly accepted a mismatched digest.' >&2
  exit 1
fi

echo 'Wallet acceptance evidence tests passed.'
