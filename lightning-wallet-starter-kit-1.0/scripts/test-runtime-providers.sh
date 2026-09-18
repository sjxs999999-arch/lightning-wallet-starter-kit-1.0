#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MOCK=$SCRIPT_DIR/fixtures/mock-runtime-provider-curl.sh

CURL_BIN="$MOCK" API_ORIGIN=https://api.example.test "$SCRIPT_DIR/verify-runtime-providers.sh" internal >/dev/null
MOCK_RUNTIME_PROVIDER_MODE=public CURL_BIN="$MOCK" API_ORIGIN=https://api.example.test "$SCRIPT_DIR/verify-runtime-providers.sh" public >/dev/null

if CURL_BIN="$MOCK" API_ORIGIN=https://api.example.test "$SCRIPT_DIR/verify-runtime-providers.sh" public >/dev/null 2>&1; then
  echo 'Runtime-provider verifier unexpectedly accepted testnet-only providers for public beta.' >&2
  exit 1
fi

if MOCK_RUNTIME_PROVIDER_MODE=offline CURL_BIN="$MOCK" API_ORIGIN=https://api.example.test "$SCRIPT_DIR/verify-runtime-providers.sh" internal >/dev/null 2>&1; then
  echo 'Runtime-provider verifier unexpectedly accepted an offline Flash Loan provider.' >&2
  exit 1
fi

if MOCK_RUNTIME_PROVIDER_MODE=dry-run CURL_BIN="$MOCK" API_ORIGIN=https://api.example.test "$SCRIPT_DIR/verify-runtime-providers.sh" internal >/dev/null 2>&1; then
  echo 'Runtime-provider verifier unexpectedly accepted a Dry Run-only GasFree provider.' >&2
  exit 1
fi

sh -n "$SCRIPT_DIR/verify-runtime-providers.sh" "$MOCK"
echo 'Internal/public runtime-provider gate tests passed.'
