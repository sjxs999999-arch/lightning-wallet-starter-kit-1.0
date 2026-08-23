#!/usr/bin/env sh
set -eu

TARGET=${1:-.}
# A clean production build currently needs room for both the API and Web images,
# their temporary BuildKit layers and the existing rollback images. Eight GiB
# proved insufficient on the production host, so fail closed below 20 GiB.
MIN_DEPLOY_DISK_KB=${MIN_DEPLOY_DISK_KB:-20971520}

case "$MIN_DEPLOY_DISK_KB" in
  ''|*[!0-9]*) echo "MIN_DEPLOY_DISK_KB must be a positive integer." >&2; exit 2 ;;
esac
test "$MIN_DEPLOY_DISK_KB" -gt 0 || { echo "MIN_DEPLOY_DISK_KB must be greater than zero." >&2; exit 2; }

AVAILABLE_KB=$(df -Pk "$TARGET" | awk 'NR==2 {print $4}')
case "$AVAILABLE_KB" in
  ''|*[!0-9]*) echo "Unable to determine available disk space for $TARGET." >&2; exit 2 ;;
esac

if [ "$AVAILABLE_KB" -lt "$MIN_DEPLOY_DISK_KB" ]; then
  echo "Deployment preflight failed: ${AVAILABLE_KB}KB available; ${MIN_DEPLOY_DISK_KB}KB required." >&2
  echo "Review 'docker system df' and remove only unused build cache or images before retrying." >&2
  exit 1
fi

echo "Deployment disk preflight passed: ${AVAILABLE_KB}KB available."
