#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
VALID_FIXTURE=$SCRIPT_DIR/fixtures/production-env.valid.test
EXAMPLE_FILE=$SCRIPT_DIR/../.env.production.example

sh -n "$SCRIPT_DIR/check-production-env.sh" "$SCRIPT_DIR/deploy.sh" "$SCRIPT_DIR/rollback-release.sh" "$SCRIPT_DIR/verify-live-providers.sh"
PRODUCTION_ENV_FILE="$VALID_FIXTURE" "$SCRIPT_DIR/check-production-env.sh"

if STRICT_EXTERNAL_PROVIDERS=true PRODUCTION_ENV_FILE="$VALID_FIXTURE" "$SCRIPT_DIR/check-production-env.sh"; then
  echo 'Strict provider gate unexpectedly accepted missing providers.' >&2
  exit 1
fi

if PRODUCTION_ENV_FILE="$EXAMPLE_FILE" "$SCRIPT_DIR/check-production-env.sh"; then
  echo 'Production example unexpectedly passed with placeholder credentials.' >&2
  exit 1
fi

echo 'Production environment gate tests passed.'
