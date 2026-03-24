#!/usr/bin/env sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-./backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
FILE_NAME="ctv-management-${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"
ABS_BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"

docker run --rm \
  -e DATABASE_URL="$DATABASE_URL" \
  -e FILE_NAME="$FILE_NAME" \
  -v "${ABS_BACKUP_DIR}:/backups" \
  postgres:16-alpine \
  sh -lc 'pg_dump --format=custom --no-owner --no-privileges --file "/backups/$FILE_NAME" "$DATABASE_URL"'

find "$ABS_BACKUP_DIR" -type f -name 'ctv-management-*.dump' -mtime "+${RETENTION_DAYS}" -delete

echo "Backup created at ${ABS_BACKUP_DIR}/${FILE_NAME}"
