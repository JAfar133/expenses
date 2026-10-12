#!/usr/bin/env bash
# PostgreSQL backup on the server: dump, verification, copy to OneDrive, removal of old copies.
#
#   ./scripts/backup-db.sh
#
# Run in the project folder (cron: see docs/DEPLOY.md, section 10.3). The copy is written to a temporary file and
# renamed only after verification, so a failed dump never leaves a "good-looking" archive, and old copies are
# removed only after a successful backup. Settings (environment variables, all optional):
#   BACKUP_DIR         where copies are stored on this machine        (default ~/backups)
#   BACKUP_KEEP_DAYS   how long local copies are kept                  (default 14)
#   BACKUP_REMOTE_DIR  folder in OneDrive for the off-host copy        (default "Бэкапы/expenses")
#   BACKUP_REMOTE_KEEP_DAYS  how long copies in OneDrive are kept      (default 30)
# The OneDrive copy needs the rclone config of the backend container (ONEDRIVE_FILE_PATH is set in .env).
set -euo pipefail
umask 077
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

cd "$ROOT_DIR"
require_command docker "Установите Docker."

# Value from .env (read as text, not executed)
env_value() {
  local value
  value="$(sed -n "s/^$1=//p" .env 2>/dev/null | tail -n1)"
  printf '%s' "${value:-${2:-}}"
}

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
REMOTE_DIR="${BACKUP_REMOTE_DIR:-Бэкапы/expenses}"
REMOTE_KEEP_DAYS="${BACKUP_REMOTE_KEEP_DAYS:-30}"
DB_USER="$(env_value POSTGRES_USER expenses)"
DB_NAME="$(env_value POSTGRES_DB expenses)"
REMOTE="$(env_value ONEDRIVE_REMOTE onedrive)"
USE_ONEDRIVE=0
[ -n "$(env_value ONEDRIVE_FILE_PATH)" ] && USE_ONEDRIVE=1

mkdir -p "$BACKUP_DIR"
name="expenses-$(date +%F-%H%M).sql.gz"
final="$BACKUP_DIR/$name"
partial="$final.tmp"
trap 'rm -f "$partial"' EXIT

log "Делаю дамп базы $DB_NAME"
# pipefail: a failed pg_dump is not hidden by a successful gzip
nice -n 10 docker compose exec -T postgres pg_dump -U "$DB_USER" --clean --if-exists "$DB_NAME" \
  | gzip > "$partial" || fail "pg_dump завершился с ошибкой, копия не создана"

gzip -t "$partial" || fail "архив повреждён"
# grep without -q reads the whole dump: with `-q` it exits at the first match, zcat gets SIGPIPE and pipefail fails the check
zcat "$partial" | grep '^COPY public.expenses ' >/dev/null || fail "в дампе нет таблицы expenses, копия отброшена"
[ "$(wc -c < "$partial")" -gt 1000 ] || fail "дамп подозрительно маленький, копия отброшена"
mv "$partial" "$final"
log "Копия готова: $final ($(du -h "$final" | cut -f1))"

# Old local copies go only now that a new one exists (copies made before deployments, db-before-*, are not touched)
find "$BACKUP_DIR" -maxdepth 1 -name 'expenses-*.sql.gz' -mtime "+$KEEP_DAYS" -delete

upload_failed=0
if [ "$USE_ONEDRIVE" = 1 ]; then
  log "Копирую в OneDrive: $REMOTE:$REMOTE_DIR/$name"
  rclone_in_backend='RCLONE_CONFIG=/data/rclone/rclone.conf rclone'
  if docker compose exec -T backend sh -c "$rclone_in_backend rcat \"\$0\"" "$REMOTE:$REMOTE_DIR/$name" < "$final"; then
    docker compose exec -T backend sh -c "$rclone_in_backend delete --min-age \"\$1\" \"\$0\"" \
      "$REMOTE:$REMOTE_DIR" "${REMOTE_KEEP_DAYS}d" \
      || log "Предупреждение: не удалось удалить старые копии в OneDrive"
    log "Копия в OneDrive загружена"
  else
    upload_failed=1
  fi
else
  log "ONEDRIVE_FILE_PATH не задан: копия в OneDrive пропущена"
fi

[ "$upload_failed" = 0 ] || fail "не удалось загрузить копию в OneDrive (локальная копия сохранена: $final)"
