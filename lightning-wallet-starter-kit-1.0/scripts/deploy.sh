#!/usr/bin/env sh
set -eu
test -f .env || { echo "Missing .env. Copy .env.example and configure secrets first."; exit 1; }
docker compose build
docker compose up -d
docker compose ps
