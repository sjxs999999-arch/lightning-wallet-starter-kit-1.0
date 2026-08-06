#!/bin/sh
set -eu
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then echo "Usage: $0 backups/lightning-TIMESTAMP.dump" >&2; exit 2; fi
echo "Restore replaces the Lightning Wallet database. Type RESTORE to continue:"
read -r CONFIRM
[ "$CONFIRM" = RESTORE ] || { echo "Cancelled"; exit 1; }
docker compose -f docker-compose.production.yml exec -T postgres pg_restore -U lightning -d lightning_wallet --clean --if-exists < "$1"
echo "Restore completed. Run health checks before reopening traffic."
