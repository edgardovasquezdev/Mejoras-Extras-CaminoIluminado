#!/usr/bin/env bash
# Carga las variables de .env y arranca el servidor. Ejecutar desde la raíz del proyecto.
set -euo pipefail
[ -f .env ] || { echo "Crea el archivo .env a partir de .env.example"; exit 1; }
set -a; . ./.env; set +a
cd backend && mvn compile exec:java
