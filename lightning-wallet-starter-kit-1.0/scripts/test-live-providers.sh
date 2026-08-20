#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MOCK=$SCRIPT_DIR/fixtures/mock-live-provider-curl.sh

sh -n "$SCRIPT_DIR/verify-live-providers.sh" "$MOCK"
CURL_BIN="$MOCK" API_ORIGIN=https://api.example.test CLIENT_ORIGIN=https://client.example.test "$SCRIPT_DIR/verify-live-providers.sh"

if MOCK_LIVE_PROVIDER_FIXTURE="$SCRIPT_DIR/fixtures/live-sunswap.invalid.json" CURL_BIN="$MOCK" API_ORIGIN=https://api.example.test CLIENT_ORIGIN=https://client.example.test "$SCRIPT_DIR/verify-live-providers.sh"; then
  echo 'Live provider verifier unexpectedly accepted a sensitive response.' >&2
  exit 1
fi

echo 'Live provider verifier tests passed.'
