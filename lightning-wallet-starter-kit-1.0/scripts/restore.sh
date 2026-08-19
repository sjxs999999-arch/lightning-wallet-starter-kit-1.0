#!/bin/sh
set -eu
PRODUCTION_ENV_FILE=${PRODUCTION_ENV_FILE:-.env.production}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.production.yml}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-lightning-wallet}

if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then echo "Usage: $0 backups/lightning-TIMESTAMP.dump" >&2; exit 2; fi
test -f "$PRODUCTION_ENV_FILE" || { echo "Missing $PRODUCTION_ENV_FILE" >&2; exit 1; }
test -f "$COMPOSE_FILE" || { echo "Missing $COMPOSE_FILE" >&2; exit 1; }
echo "Restore replaces the Lightning Wallet database. Type RESTORE to continue:"
read -r CONFIRM
[ "$CONFIRM" = RESTORE ] || { echo "Cancelled"; exit 1; }
docker compose --env-file "$PRODUCTION_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" exec -T postgres pg_restore -U lightning -d lightning_wallet --clean --if-exists < "$1"
echo "Restore completed. Run health checks before reopening traffic."
