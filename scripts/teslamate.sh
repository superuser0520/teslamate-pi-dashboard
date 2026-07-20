#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

command="${1:-status}"
backup_dir="${BACKUP_DIR:-backups}"
timestamp="$(date +%Y%m%d-%H%M%S)"

case "$command" in
  start)
    docker compose up -d
    ;;
  stop)
    docker compose stop
    ;;
  restart)
    docker compose restart
    ;;
  status)
    docker compose ps
    ;;
  logs)
    if [ -n "${2:-}" ]; then
      docker compose logs -f --tail=200 "$2"
    else
      docker compose logs -f --tail=200
    fi
    ;;
  update)
    docker compose pull
    docker compose up -d
    docker image prune -f
    ;;
  backup)
    mkdir -p "$backup_dir"
    docker compose exec -T database pg_dump \
      -U "${DATABASE_USER:-teslamate}" \
      "${DATABASE_NAME:-teslamate}" \
      | gzip > "${backup_dir}/teslamate-${timestamp}.sql.gz"
    echo "Wrote ${backup_dir}/teslamate-${timestamp}.sql.gz"
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs|update|backup}"
    exit 1
    ;;
esac
