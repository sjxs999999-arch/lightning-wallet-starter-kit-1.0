#!/usr/bin/env sh
set -eu
PRODUCTION_ENV_FILE=${PRODUCTION_ENV_FILE:-.env.production}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.production.yml}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-lightning-wallet}
DEPLOY_WAIT_SECONDS=${DEPLOY_WAIT_SECONDS:-150}
DEPLOY_PRUNE_BUILD_CACHE=${DEPLOY_PRUNE_BUILD_CACHE:-true}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

case "$DEPLOY_WAIT_SECONDS" in
  ''|*[!0-9]*) echo 'DEPLOY_WAIT_SECONDS must be a positive integer.' >&2; exit 2 ;;
esac
test "$DEPLOY_WAIT_SECONDS" -gt 0 || { echo 'DEPLOY_WAIT_SECONDS must be greater than zero.' >&2; exit 2; }
case "$DEPLOY_PRUNE_BUILD_CACHE" in
  true|false) : ;;
  *) echo 'DEPLOY_PRUNE_BUILD_CACHE must be true or false.' >&2; exit 2 ;;
esac

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

if [ "$DEPLOY_PRUNE_BUILD_CACHE" = true ]; then
  echo 'Removing unused Docker build cache before production disk preflight.'
  docker builder prune --all --force
fi

"$SCRIPT_DIR/check-deploy-disk.sh" "$(dirname "$COMPOSE_FILE")"

docker compose --env-file "$PRODUCTION_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" config --quiet
docker compose --env-file "$PRODUCTION_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" build
docker compose --env-file "$PRODUCTION_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" up -d
docker compose --env-file "$PRODUCTION_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" ps

started_at=$(date +%s)
while :; do
  all_healthy=true
  for service in api web; do
    container_id=$(docker compose --env-file "$PRODUCTION_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" ps -q "$service")
    if [ -z "$container_id" ]; then
      all_healthy=false
      continue
    fi
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)
    [ "$health" = healthy ] || all_healthy=false
  done
  [ "$all_healthy" = true ] && break
  elapsed=$(( $(date +%s) - started_at ))
  if [ "$elapsed" -ge "$DEPLOY_WAIT_SECONDS" ]; then
    echo "Deployment health wait timed out after ${elapsed}s." >&2
    docker compose --env-file "$PRODUCTION_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" ps >&2
    exit 1
  fi
  sleep 2
done

echo 'Deployment containers are healthy.'
