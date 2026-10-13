#!/usr/bin/env bash
# Daily copy of receipt photos to OneDrive (the database backup does not contain the files).
#
#   ./scripts/backup-receipts.sh
#
# `rclone copy` only adds new files and never deletes anything at the destination, so a photo that was removed
# in the app (its file stays on the disk anyway) is never lost from the copy. Run it from cron after backup-db.sh
# (see docs/DEPLOY.md). Settings (environment variables, all optional):
#   BACKUP_REMOTE_DIR  folder in OneDrive; the photos go to its "receipts" subfolder   (default "Бэкапы/expenses")
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

cd "$ROOT_DIR"
require_command docker "Установите Docker."

env_value() {
  local value
  value="$(sed -n "s/^$1=//p" .env 2>/dev/null | tail -n1)"
  printf '%s' "${value:-${2:-}}"
}

if [ -z "$(env_value ONEDRIVE_FILE_PATH)" ]; then
  log "ONEDRIVE_FILE_PATH не задан: копия чеков в OneDrive пропущена"
  exit 0
fi

REMOTE="$(env_value ONEDRIVE_REMOTE onedrive)"
REMOTE_DIR="${BACKUP_REMOTE_DIR:-Бэкапы/expenses}/receipts"

log "Копирую фото чеков в OneDrive: $REMOTE:$REMOTE_DIR"
docker compose exec -T backend sh -c \
  'mkdir -p /data/receipts && RCLONE_CONFIG=/data/rclone/rclone.conf rclone copy /data/receipts "$0"' \
  "$REMOTE:$REMOTE_DIR" || fail "не удалось скопировать фото чеков в OneDrive"
log "Фото чеков скопированы"
