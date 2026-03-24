#!/usr/bin/env sh
set -eu

if [ $# -ne 1 ]; then
  echo "Usage: $0 /absolute/or/relative/path/to/backup.dump" >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi

if [ "${CONFIRM_RESTORE:-}" != "restore" ]; then
  echo "Set CONFIRM_RESTORE=restore to continue." >&2
  exit 1
fi

BACKUP_PATH="$1"
if [ ! -f "$BACKUP_PATH" ]; then
  echo "Backup file not found: $BACKUP_PATH" >&2
  exit 1
fi

ABS_BACKUP_DIR="$(cd "$(dirname "$BACKUP_PATH")" && pwd)"
FILE_NAME="$(basename "$BACKUP_PATH")"

docker run --rm \
  -e DATABASE_URL="$DATABASE_URL" \
  -e FILE_NAME="$FILE_NAME" \
  -v "${ABS_BACKUP_DIR}:/backups" \
  postgres:16-alpine \
  sh -lc 'pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$DATABASE_URL" "/backups/$FILE_NAME"'

echo "Restore completed from ${BACKUP_PATH}"
