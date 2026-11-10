#!/usr/bin/env bash
# Inicializa la base de datos de ThingsBoard (solo la primera vez).
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose up -d tb-postgres
echo "Esperando a PostgreSQL..."
until docker compose exec -T tb-postgres pg_isready -U postgres >/dev/null 2>&1; do sleep 2; done

docker compose run --rm -e INSTALL_TB=true -e LOAD_DEMO=true thingsboard
echo "ThingsBoard inicializado. Arranca el laboratorio con: docker compose up -d --build"
