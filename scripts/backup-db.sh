#!/usr/bin/env bash
# PostgreSQL backup on the server: dump, verification, copy to OneDrive, removal of old copies.
#
#   ./scripts/backup-db.sh
#
# After every run it writes two small status files next to the copies (the app shows them to the administrator):
#   backup-last-run.json      {"at", "ok", "error"}          the last run, also a failed one
#   backup-last-success.json  {"at", "file", "sizeBytes", "remote"}   the last good copy; remote: ok | failed | off
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

# Status files for the app (readable by the container: the umask above would make them private)
now_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }
write_status_file() {
  local file="$BACKUP_DIR/$1" content="$2"
  printf '%s\n' "$content" > "$file.tmp" && chmod 644 "$file.tmp" && mv "$file.tmp" "$file"
}
error_code=""
finished_ok=0
# Whatever happens (also a failed check), the last run is recorded; the temporary file is removed
on_exit() {
  rm -f "$partial"
  if [ "$finished_ok" = 1 ]; then
    write_status_file backup-last-run.json "{\"at\":\"$(now_utc)\",\"ok\":true,\"error\":\"\"}"
  else
    write_status_file backup-last-run.json "{\"at\":\"$(now_utc)\",\"ok\":false,\"error\":\"${error_code:-unexpected}\"}"
  fi
}
trap on_exit EXIT
# Fails with a short code for the status file and a message for the log
die() { error_code="$1"; shift; fail "$*"; }

log "Делаю дамп базы $DB_NAME"
# pipefail: a failed pg_dump is not hidden by a successful gzip
nice -n 10 docker compose exec -T postgres pg_dump -U "$DB_USER" --clean --if-exists "$DB_NAME" \
  | gzip > "$partial" || die dump_failed "pg_dump завершился с ошибкой, копия не создана"

gzip -t "$partial" || die verify_failed "архив повреждён"
# grep without -q reads the whole dump: with `-q` it exits at the first match, zcat gets SIGPIPE and pipefail fails the check
gzip -dc "$partial" | grep '^COPY public.expenses ' >/dev/null || die verify_failed "в дампе нет таблицы expenses, копия отброшена"
[ "$(wc -c < "$partial")" -gt 1000 ] || die verify_failed "дамп подозрительно маленький, копия отброшена"
mv "$partial" "$final"
log "Копия готова: $final ($(du -h "$final" | cut -f1))"

# Old local copies go only now that a new one exists (copies made before deployments, db-before-*, are not touched)
find "$BACKUP_DIR" -maxdepth 1 -name 'expenses-*.sql.gz' -mtime "+$KEEP_DAYS" -delete

upload_failed=0
remote_state=off
if [ "$USE_ONEDRIVE" = 1 ]; then
  log "Копирую в OneDrive: $REMOTE:$REMOTE_DIR/$name"
  rclone_in_backend='RCLONE_CONFIG=/data/rclone/rclone.conf rclone'
  if docker compose exec -T backend sh -c "$rclone_in_backend rcat \"\$0\"" "$REMOTE:$REMOTE_DIR/$name" < "$final"; then
    docker compose exec -T backend sh -c "$rclone_in_backend delete --min-age \"\$1\" \"\$0\"" \
      "$REMOTE:$REMOTE_DIR" "${REMOTE_KEEP_DAYS}d" \
      || log "Предупреждение: не удалось удалить старые копии в OneDrive"
    log "Копия в OneDrive загружена"
    remote_state=ok
  else
    upload_failed=1
    remote_state=failed
  fi
else
  log "ONEDRIVE_FILE_PATH не задан: копия в OneDrive пропущена"
fi

# The local copy is good in any case
write_status_file backup-last-success.json "{\"at\":\"$(now_utc)\",\"file\":\"$name\",\"sizeBytes\":$(wc -c < "$final" | tr -d ' '),\"remote\":\"$remote_state\"}"

[ "$upload_failed" = 0 ] || die upload_failed "не удалось загрузить копию в OneDrive (локальная копия сохранена: $final)"
finished_ok=1
