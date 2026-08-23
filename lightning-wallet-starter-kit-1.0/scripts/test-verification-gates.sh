#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
VALID_FIXTURE=$SCRIPT_DIR/fixtures/final-readiness.valid.json
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT HUP INT TERM

mkdir "$TEST_DIR/bin"
cp "$SCRIPT_DIR/fixtures/mock-readiness-curl.sh" "$TEST_DIR/bin/curl"
chmod +x "$TEST_DIR/bin/curl"

grep -q '\.data\.security\.serverBroadcast == false' "$SCRIPT_DIR/verify-production.sh" || {
  echo 'Production acceptance is missing the serverBroadcast safety gate.' >&2
  exit 1
}

grep -q '\.data\.security\.serverBroadcast == false' "$SCRIPT_DIR/verify-final-readiness.sh" || {
  echo 'Final readiness is missing the serverBroadcast safety gate.' >&2
  exit 1
}

VERIFY_FIXTURE="$VALID_FIXTURE" PATH="$TEST_DIR/bin:$PATH" \
  "$SCRIPT_DIR/verify-final-readiness.sh" >/dev/null

sed 's/"serverBroadcast": false/"serverBroadcast": true/' "$VALID_FIXTURE" > "$TEST_DIR/server-broadcast-enabled.json"
if VERIFY_FIXTURE="$TEST_DIR/server-broadcast-enabled.json" PATH="$TEST_DIR/bin:$PATH" \
  "$SCRIPT_DIR/verify-final-readiness.sh" >/dev/null 2>&1; then
  echo 'Final readiness unexpectedly accepted server-side transaction broadcasting.' >&2
  exit 1
fi

echo 'Production verification safety gate tests passed.'
