#!/bin/sh
set -eu
umask 077

BACKUP_DIR=${BACKUP_DIR:-./backups}
PRODUCTION_ENV_FILE=${PRODUCTION_ENV_FILE:-.env.production}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.production.yml}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-lightning-wallet}

test -f "$PRODUCTION_ENV_FILE" || { echo "Missing $PRODUCTION_ENV_FILE" >&2; exit 1; }
test -f "$COMPOSE_FILE" || { echo "Missing $COMPOSE_FILE" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_FILE="$BACKUP_DIR/lightning-$STAMP.dump"
BACKUP_TEMP="$BACKUP_FILE.tmp"
trap 'rm -f "$BACKUP_TEMP"' EXIT HUP INT TERM
docker compose --env-file "$PRODUCTION_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" exec -T postgres pg_dump -U lightning -d lightning_wallet -Fc > "$BACKUP_TEMP"
test -s "$BACKUP_TEMP"
mv "$BACKUP_TEMP" "$BACKUP_FILE"
trap - EXIT HUP INT TERM
find "$BACKUP_DIR" -type f -name 'lightning-*.dump' -mtime +14 -delete
echo "Backup created: $BACKUP_FILE"
