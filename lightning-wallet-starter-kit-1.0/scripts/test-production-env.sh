#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
VALID_FIXTURE=$SCRIPT_DIR/fixtures/production-env.valid.test
EXAMPLE_FILE=$SCRIPT_DIR/../.env.production.example

sh -n "$SCRIPT_DIR/check-deploy-disk.sh" "$SCRIPT_DIR/check-production-env.sh" "$SCRIPT_DIR/deploy.sh" "$SCRIPT_DIR/promote-release.sh" "$SCRIPT_DIR/rollback-release.sh" "$SCRIPT_DIR/verify-production.sh" "$SCRIPT_DIR/verify-final-readiness.sh" "$SCRIPT_DIR/verify-live-providers.sh" "$SCRIPT_DIR/test-deploy-disk.sh" "$SCRIPT_DIR/test-promote-release.sh" "$SCRIPT_DIR/test-verification-gates.sh"
PRODUCTION_ENV_FILE="$VALID_FIXTURE" "$SCRIPT_DIR/check-production-env.sh"

mainnet_fixture=$(mktemp)
bridge_fixture=$(mktemp)
swap_fixture=$(mktemp)
trap 'rm -f "$mainnet_fixture" "$bridge_fixture" "$swap_fixture"' EXIT
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

if PRODUCTION_ENV_FILE="$EXAMPLE_FILE" "$SCRIPT_DIR/check-production-env.sh"; then
  echo 'Production example unexpectedly passed with placeholder credentials.' >&2
  exit 1
fi

echo 'Production environment gate tests passed.'
