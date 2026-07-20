#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Install Docker first, then run this script again."
  echo "See: https://docs.docker.com/engine/install/debian/"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is not available. Install the Docker Compose plugin first."
  echo "See: https://docs.docker.com/compose/install/linux/"
  exit 1
fi

if [ ! -f .env ]; then
  encryption_key="$(openssl rand -hex 32)"
  postgres_password="$(openssl rand -base64 36 | tr -d '\n')"

  sed \
    -e "s|replace-with-a-long-random-secret|${encryption_key}|g" \
    -e "s|replace-with-a-secure-database-password|${postgres_password}|g" \
    .env.example > .env

  chmod 600 .env
  echo "Created .env with generated secrets."
else
  echo ".env already exists; leaving it unchanged."
fi

grep -q '^DASHBOARD_PORT=' .env || echo 'DASHBOARD_PORT=8080' >> .env
grep -q '^DASHBOARD_TOKEN=' .env || echo 'DASHBOARD_TOKEN=' >> .env
grep -q '^CLOUDFLARED_TOKEN=' .env || echo 'CLOUDFLARED_TOKEN=' >> .env

if grep -q '^GRAFANA_PORT=3000$' .env; then
  sed -i 's/^GRAFANA_PORT=3000$/GRAFANA_PORT=3001/' .env
  echo "Moved Grafana from port 3000 to 3001 to avoid common port conflicts."
fi

mkdir -p import backups

docker compose pull
docker compose up -d --build

pi_ip="$(hostname -I | awk '{print $1}')"
teslamate_port="$(grep -E '^TESLAMATE_PORT=' .env | cut -d= -f2 || true)"
grafana_port="$(grep -E '^GRAFANA_PORT=' .env | cut -d= -f2 || true)"
dashboard_port="$(grep -E '^DASHBOARD_PORT=' .env | cut -d= -f2 || true)"
echo
echo "TeslaMate is starting."
echo "TeslaMate: http://${pi_ip}:${teslamate_port:-4000}"
echo "Grafana:    http://${pi_ip}:${grafana_port:-3001}"
echo "Dashboard:  http://${pi_ip}:${dashboard_port:-8080}"
echo
echo "Grafana default login is admin / admin. Change it on first login."
