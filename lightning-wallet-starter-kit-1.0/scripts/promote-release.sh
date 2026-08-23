#!/bin/sh
set -eu

RELEASES_ROOT=${RELEASES_ROOT:-/opt/lightning-wallet/releases}
CURRENT_LINK=${CURRENT_LINK:-/opt/lightning-wallet/current}
PREVIOUS_LINK=${PREVIOUS_LINK:-/opt/lightning-wallet/previous}
BACKUP_DIR=${BACKUP_DIR:-/opt/lightning-wallet/backups}
PROMOTE_EXECUTE=${PROMOTE_EXECUTE:-false}
PROMOTE_CONFIRM=${PROMOTE_CONFIRM:-}
PROMOTE_SKIP_PREFLIGHT=${PROMOTE_SKIP_PREFLIGHT:-false}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-lightning-wallet}

usage() {
  echo "Usage: $0 <release-id>" >&2
  echo 'Default mode is a non-mutating plan. Execute only with PROMOTE_EXECUTE=true and PROMOTE_CONFIRM=<release-id>.' >&2
  exit 2
}

[ "$#" -eq 1 ] || usage
release_id=$1
case "$release_id" in
  ''|.*|*[!A-Za-z0-9._-]*) echo 'Release ID contains unsafe characters.' >&2; exit 2 ;;
esac

canonical_dir() {
  directory=$1
  (CDPATH= cd -- "$directory" 2>/dev/null && pwd -P)
}

resolve_link() {
  link=$1
  link_dir=$(dirname "$link")
  link_value=$(readlink "$link")
  case "$link_value" in
    /*) canonical_dir "$link_value" ;;
    *) canonical_dir "$link_dir/$link_value" ;;
  esac
}

atomic_link() {
  destination=$1
  link=$2
  temporary="${link}.next.$$"
  rm -f "$temporary"
  ln -s "$destination" "$temporary"
  mv -Tf "$temporary" "$link"
}

root=$(canonical_dir "$RELEASES_ROOT") || { echo "Release root not found: $RELEASES_ROOT" >&2; exit 1; }
target=$(canonical_dir "$root/$release_id") || { echo "Release not found: $release_id" >&2; exit 1; }
current=$(resolve_link "$CURRENT_LINK") || { echo "Current release link is invalid: $CURRENT_LINK" >&2; exit 1; }

case "$target/" in "$root/"*) : ;; *) echo 'Target release resolves outside RELEASES_ROOT.' >&2; exit 1 ;; esac
case "$current/" in "$root/"*) : ;; *) echo 'Current release resolves outside RELEASES_ROOT.' >&2; exit 1 ;; esac
[ "$target" != "$current" ] || { echo "Release $release_id is already current." >&2; exit 1; }

for required_file in .env.production docker-compose.production.yml scripts/deploy.sh scripts/backup.sh scripts/verify-production.sh; do
  [ -f "$target/$required_file" ] || { echo "Target release is missing $required_file" >&2; exit 1; }
done

if [ "$PROMOTE_SKIP_PREFLIGHT" = true ]; then
  [ "$PROMOTE_EXECUTE" != true ] || { echo 'PROMOTE_SKIP_PREFLIGHT is forbidden during execution.' >&2; exit 1; }
else
  if [ -x "$target/scripts/check-production-env.sh" ]; then
    (cd "$target" && PRODUCTION_ENV_FILE=.env.production ./scripts/check-production-env.sh)
  fi
  command -v docker >/dev/null 2>&1 || { echo 'Docker is required for promotion preflight.' >&2; exit 1; }
  docker compose --env-file "$target/.env.production" -p "$COMPOSE_PROJECT_NAME" -f "$target/docker-compose.production.yml" config --quiet
fi

printf 'Promotion plan verified:\n'
printf '  current: %s\n' "$current"
printf '  target:  %s\n' "$target"
printf '  backup:  %s\n' "$BACKUP_DIR"

if [ "$PROMOTE_EXECUTE" != true ]; then
  echo 'DRY RUN ONLY: no symlink, container or database state was changed.'
  exit 0
fi

[ "$PROMOTE_CONFIRM" = "$release_id" ] || { echo 'PROMOTE_CONFIRM must exactly match the target release ID.' >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo 'Executed promotion must run as root.' >&2; exit 1; }

if command -v flock >/dev/null 2>&1; then
  exec 9>/var/lock/lightning-wallet-release.lock
  flock -n 9 || { echo 'Another Lightning Wallet release operation is already running.' >&2; exit 1; }
fi

started=$(date +%s)
mkdir -p "$BACKUP_DIR"
(cd "$current" && BACKUP_DIR="$BACKUP_DIR" PRODUCTION_ENV_FILE=.env.production ./scripts/backup.sh)

# Keep CURRENT_LINK on the verified release during build and health checks.
# If the target fails, redeploy the still-current release to undo any partial
# container recreation; no link recovery allocation is required.
if (cd "$target" && PRODUCTION_ENV_FILE=.env.production ./scripts/deploy.sh && ./scripts/verify-production.sh); then
  atomic_link "$current" "$PREVIOUS_LINK"
  atomic_link "$target" "$CURRENT_LINK"
  finished=$(date +%s)
  printf 'Promotion completed in %s seconds. Database data was preserved.\n' "$((finished - started))"
  exit 0
fi

echo 'Target release failed deployment or verification; redeploying the unchanged current release.' >&2
if (cd "$current" && PRODUCTION_ENV_FILE=.env.production ./scripts/deploy.sh && ./scripts/verify-production.sh); then
  echo 'Original release restored successfully.' >&2
else
  echo 'CRITICAL: automatic recovery failed; keep traffic closed and follow the incident runbook.' >&2
fi
exit 1
