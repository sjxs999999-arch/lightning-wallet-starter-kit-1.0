#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT HUP INT TERM
mkdir -p "$TEST_ROOT/releases/current/scripts" "$TEST_ROOT/releases/target/scripts" "$TEST_ROOT/backups"

for release in current target; do
  touch "$TEST_ROOT/releases/$release/.env.production"
  touch "$TEST_ROOT/releases/$release/docker-compose.production.yml"
  touch "$TEST_ROOT/releases/$release/scripts/deploy.sh"
  touch "$TEST_ROOT/releases/$release/scripts/backup.sh"
  touch "$TEST_ROOT/releases/$release/scripts/verify-production.sh"
done
ln -s "$TEST_ROOT/releases/current" "$TEST_ROOT/current"

RELEASES_ROOT="$TEST_ROOT/releases" CURRENT_LINK="$TEST_ROOT/current" PREVIOUS_LINK="$TEST_ROOT/previous" BACKUP_DIR="$TEST_ROOT/backups" PROMOTE_SKIP_PREFLIGHT=true "$SCRIPT_DIR/promote-release.sh" target

[ "$(readlink "$TEST_ROOT/current")" = "$TEST_ROOT/releases/current" ] || {
  echo 'Promotion dry run changed the current release.' >&2
  exit 1
}

if RELEASES_ROOT="$TEST_ROOT/releases" CURRENT_LINK="$TEST_ROOT/current" PROMOTE_SKIP_PREFLIGHT=true "$SCRIPT_DIR/promote-release.sh" current; then
  echo 'Promotion planner unexpectedly accepted the current release.' >&2
  exit 1
fi

if RELEASES_ROOT="$TEST_ROOT/releases" CURRENT_LINK="$TEST_ROOT/current" PROMOTE_SKIP_PREFLIGHT=true "$SCRIPT_DIR/promote-release.sh" ../target; then
  echo 'Promotion planner unexpectedly accepted an unsafe release ID.' >&2
  exit 1
fi

if RELEASES_ROOT="$TEST_ROOT/releases" CURRENT_LINK="$TEST_ROOT/current" PROMOTE_SKIP_PREFLIGHT=true PROMOTE_EXECUTE=true PROMOTE_CONFIRM=target "$SCRIPT_DIR/promote-release.sh" target; then
  echo 'Promotion execution unexpectedly bypassed preflight.' >&2
  exit 1
fi

echo 'Promotion release planner tests passed.'
