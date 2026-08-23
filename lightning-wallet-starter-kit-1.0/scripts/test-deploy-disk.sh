#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT HUP INT TERM

cat > "$TEST_ROOT/df" <<'EOF'
#!/bin/sh
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf '/dev/test 30000000 9000000 %s 30%% /test\n' "${TEST_AVAILABLE_KB:?}"
EOF
chmod +x "$TEST_ROOT/df"

PATH="$TEST_ROOT:$PATH" TEST_AVAILABLE_KB=20971520 "$SCRIPT_DIR/check-deploy-disk.sh" .

if PATH="$TEST_ROOT:$PATH" TEST_AVAILABLE_KB=20971519 "$SCRIPT_DIR/check-deploy-disk.sh" .; then
  echo 'Disk preflight unexpectedly accepted less than the 20 GiB default.' >&2
  exit 1
fi

PATH="$TEST_ROOT:$PATH" TEST_AVAILABLE_KB=1024 MIN_DEPLOY_DISK_KB=1024 "$SCRIPT_DIR/check-deploy-disk.sh" .

if PATH="$TEST_ROOT:$PATH" TEST_AVAILABLE_KB=30000000 MIN_DEPLOY_DISK_KB=invalid "$SCRIPT_DIR/check-deploy-disk.sh" .; then
  echo 'Disk preflight unexpectedly accepted an invalid threshold.' >&2
  exit 1
fi

echo 'Deployment disk preflight tests passed.'
