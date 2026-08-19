#!/usr/bin/env sh
set -eu
PRODUCTION_ENV_FILE=${PRODUCTION_ENV_FILE:-.env.production}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.production.yml}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-lightning-wallet}

test -f "$PRODUCTION_ENV_FILE" || { echo "Missing $PRODUCTION_ENV_FILE. Copy .env.production.example and configure secrets first." >&2; exit 1; }
docker compose --env-file "$PRODUCTION_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" config --quiet
docker compose --env-file "$PRODUCTION_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" build
docker compose --env-file "$PRODUCTION_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" up -d
docker compose --env-file "$PRODUCTION_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" ps
