#!/usr/bin/env sh
set -eu
PRODUCTION_ENV_FILE=${PRODUCTION_ENV_FILE:-.env.production}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.production.yml}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-lightning-wallet}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

test -f "$PRODUCTION_ENV_FILE" || { echo "Missing $PRODUCTION_ENV_FILE. Copy .env.production.example and configure secrets first." >&2; exit 1; }

PRODUCTION_ENV_FILE="$PRODUCTION_ENV_FILE" "$SCRIPT_DIR/check-production-env.sh"

DOMAIN_VALUE=$(sed -n 's/^DOMAIN=//p' "$PRODUCTION_ENV_FILE" | tail -n 1 | tr -d '\r' | sed 's/^"//;s/"$//')
test -n "$DOMAIN_VALUE" || { echo "DOMAIN is missing from $PRODUCTION_ENV_FILE." >&2; exit 1; }

COMPOSE_DIR=$(dirname "$COMPOSE_FILE")
TLS_DIR="$COMPOSE_DIR/certbot/conf/live/$DOMAIN_VALUE"
test -f "$TLS_DIR/fullchain.pem" || { echo "Missing TLS certificate for $DOMAIN_VALUE: $TLS_DIR/fullchain.pem" >&2; exit 1; }
test -f "$TLS_DIR/privkey.pem" || { echo "Missing TLS private key for $DOMAIN_VALUE: $TLS_DIR/privkey.pem" >&2; exit 1; }

if command -v openssl >/dev/null 2>&1; then
  openssl x509 -in "$TLS_DIR/fullchain.pem" -noout -checkhost "$DOMAIN_VALUE" >/dev/null 2>&1 || {
    echo "TLS certificate does not cover DOMAIN=$DOMAIN_VALUE." >&2
    exit 1
  }
fi

"$SCRIPT_DIR/check-deploy-disk.sh" "$(dirname "$COMPOSE_FILE")"

docker compose --env-file "$PRODUCTION_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" config --quiet
docker compose --env-file "$PRODUCTION_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" build
docker compose --env-file "$PRODUCTION_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" up -d
docker compose --env-file "$PRODUCTION_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" ps
