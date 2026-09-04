#!/usr/bin/env bash
#
# Restores a backup taken by scripts/backup.sh.
#
# DESTRUCTIVE: the target database is dropped and recreated. Requires an explicit
# --confirm flag so it cannot be run against production by reflex.
#
# Usage: scripts/restore.sh <backup-directory> --confirm
set -euo pipefail

SRC="${1:?usage: scripts/restore.sh <backup-directory> --confirm}"
[[ "${2:-}" == "--confirm" ]] || { echo "Refusing to restore without --confirm"; exit 1; }

PG_USER="${POSTGRES_USER:-tcms}"
PG_DB="${POSTGRES_DB:-tcms}"

[[ -f "$SRC/postgres.dump" ]] || { echo "No postgres.dump in $SRC"; exit 1; }
echo "Restoring from $SRC"
[[ -f "$SRC/manifest.txt" ]] && sed 's/^/  /' "$SRC/manifest.txt"

# The application must not hold connections while the database is dropped.
docker compose stop backend >/dev/null 2>&1 || true

echo "  postgres: recreating $PG_DB"
docker compose exec -T postgres psql -U "$PG_USER" -d postgres -q \
  -c "DROP DATABASE IF EXISTS $PG_DB WITH (FORCE);" -c "CREATE DATABASE $PG_DB;"
docker compose exec -T postgres pg_restore -U "$PG_USER" -d "$PG_DB" --no-owner \
  < "$SRC/postgres.dump"

if [[ -d "$SRC/minio" ]]; then
  echo "  minio: restoring attachment objects"
  docker compose cp "$SRC/minio" "minio:/tmp/restore-bucket" >/dev/null
  docker compose exec -T minio mc alias set local http://127.0.0.1:9000 \
    "${MINIO_ROOT_USER:-tcmsadmin}" "${MINIO_ROOT_PASSWORD:-tcmsadmin}" >/dev/null 2>&1 || true
  docker compose exec -T minio mc mb --ignore-existing "local/${S3_BUCKET:-tcms-attachments}" >/dev/null 2>&1 || true
  docker compose exec -T minio mc mirror --quiet --overwrite \
    /tmp/restore-bucket "local/${S3_BUCKET:-tcms-attachments}" >/dev/null 2>&1 || true
  docker compose exec -T minio rm -rf /tmp/restore-bucket >/dev/null 2>&1 || true
fi

docker compose start backend >/dev/null
echo "Done. Waiting for readiness..."
for _ in $(seq 1 30); do
  if curl -sf http://127.0.0.1:3000/readyz >/dev/null 2>&1; then echo "  ready."; exit 0; fi
  sleep 2
done
echo "  WARNING: the backend did not report ready within 60s"
exit 1
