#!/bin/sh
set -eu
BACKUP_DIR=${BACKUP_DIR:-./backups}
mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -f docker-compose.production.yml exec -T postgres pg_dump -U lightning -d lightning_wallet -Fc > "$BACKUP_DIR/lightning-$STAMP.dump"
find "$BACKUP_DIR" -type f -name 'lightning-*.dump' -mtime +14 -delete
echo "Backup created: $BACKUP_DIR/lightning-$STAMP.dump"
