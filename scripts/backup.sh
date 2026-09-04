#!/usr/bin/env bash
#
# Backs up everything that cannot be rebuilt: the Postgres database and the MinIO object
# store. Container images and the application are rebuildable from the repository, so they
# are deliberately not backed up.
#
# Usage: scripts/backup.sh [destination-directory]
set -euo pipefail

DEST="${1:-./backups/$(date -u +%Y-%m-%dT%H-%M-%SZ)}"
PROJECT="${COMPOSE_PROJECT_NAME:-exasol-tcms}"
PG_USER="${POSTGRES_USER:-tcms}"
PG_DB="${POSTGRES_DB:-tcms}"

mkdir -p "$DEST"
echo "Backing up to $DEST"

# --- Postgres -------------------------------------------------------------------------
# A logical dump rather than a volume copy: it restores into a different Postgres version
# and can be inspected, which a binary volume snapshot cannot.
echo "  postgres: dumping $PG_DB"
docker compose exec -T postgres pg_dump -U "$PG_USER" -d "$PG_DB" --format=custom \
  > "$DEST/postgres.dump"

# --- MinIO ----------------------------------------------------------------------------
# Attachment objects. These are referenced by rows in the dump above, so the two must be
# taken together: restoring one without the other leaves dangling references or orphans.
echo "  minio: mirroring the attachment bucket"
docker compose exec -T minio mc alias set local http://127.0.0.1:9000 \
  "${MINIO_ROOT_USER:-tcmsadmin}" "${MINIO_ROOT_PASSWORD:-tcmsadmin}" >/dev/null 2>&1 || true
docker compose exec -T minio mc mirror --quiet --overwrite \
  "local/${S3_BUCKET:-tcms-attachments}" /tmp/backup-bucket >/dev/null 2>&1 || true
docker compose cp "minio:/tmp/backup-bucket" "$DEST/minio" >/dev/null 2>&1 || mkdir -p "$DEST/minio"
docker compose exec -T minio rm -rf /tmp/backup-bucket >/dev/null 2>&1 || true

# --- Manifest --------------------------------------------------------------------------
# Records what was captured, so a restore can be checked rather than hoped for.
cat > "$DEST/manifest.txt" <<MANIFEST
taken_at        $(date -u +%Y-%m-%dT%H:%M:%SZ)
postgres_bytes  $(stat -c %s "$DEST/postgres.dump")
attachments     $(find "$DEST/minio" -type f 2>/dev/null | wc -l)
schema_version  $(docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc \
                   "select count(*) from drizzle.__drizzle_migrations" 2>/dev/null || echo unknown)
cases           $(docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc \
                   "select count(*) from test_case" 2>/dev/null || echo unknown)
results         $(docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc \
                   "select count(*) from case_result" 2>/dev/null || echo unknown)
MANIFEST

echo "Done."
cat "$DEST/manifest.txt" | sed 's/^/  /'
