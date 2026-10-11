#!/usr/bin/env bash
# Restore Excel from a backup.
#
#   ./scripts/restore-backup.sh --list            show available backups
#   ./scripts/restore-backup.sh <backup-file>     put this backup back into OneDrive
#
# Before replacing, the current version of the file is saved to backups/before-restore/, and after upload
# the file hash in OneDrive is compared with the backup hash. The file path is taken from backend/.env;
# it can be overridden: ONEDRIVE_FILE_PATH="Документы/другой.xlsx" ./scripts/restore-backup.sh ...
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

BACKEND="$ROOT_DIR/backend"

# Value from backend/.env (read as text, not executed); an environment variable takes precedence
env_value() {
  local name="$1" fallback="${2:-}"
  if [ -n "${!name:-}" ]; then printf '%s' "${!name}"; return; fi
  local value
  value="$(sed -n "s/^${name}=//p" "$BACKEND/.env" 2>/dev/null | tail -n1)"
  printf '%s' "${value:-$fallback}"
}

REMOTE="$(env_value ONEDRIVE_REMOTE onedrive)"
REMOTE_PATH="$(env_value ONEDRIVE_FILE_PATH)"
BACKUP_DIR="$(env_value BACKUP_DIR ./backups)"
case "$BACKUP_DIR" in /*) ;; *) BACKUP_DIR="$BACKEND/${BACKUP_DIR#./}" ;; esac

list_backups() {
  [ -d "$BACKUP_DIR" ] || fail "папка с копиями не найдена: $BACKUP_DIR"
  # Newest copies first; before-restore holds copies made by the restore script itself
  find "$BACKUP_DIR" -type f -name '*.xlsx' | sort -r | while read -r file; do
    printf '%s  %s\n' "$(du -h "$file" | cut -f1 | tr -d ' ')" "$file"
  done
}

if [ "${1:-}" = "--list" ]; then
  list_backups
  exit 0
fi

[ $# -eq 1 ] || fail "укажите файл копии или --list. Пример: $0 --list"
BACKUP_FILE="$1"
[ -f "$BACKUP_FILE" ] || fail "файл не найден: $BACKUP_FILE"
[ -n "$REMOTE_PATH" ] || fail "не задан ONEDRIVE_FILE_PATH (backend/.env)."
require_command rclone "Установите rclone."
require_command unzip "Нужен для проверки файла."

# The backup must be a complete Excel workbook
unzip -tqq "$BACKUP_FILE" >/dev/null 2>&1 || fail "файл повреждён или это не xlsx: $BACKUP_FILE"
unzip -l "$BACKUP_FILE" | grep -q 'xl/workbook.xml' || fail "в файле нет xl/workbook.xml, это не книга Excel."

TARGET="${REMOTE}:${REMOTE_PATH}"
log "Будет заменён файл в OneDrive: $TARGET"
log "Копия: $BACKUP_FILE"
log "Закройте файл в Excel (в том числе Excel Online и приложение на телефоне)."
printf 'Для продолжения введите "yes": '
read -r answer
[ "$answer" = "yes" ] || fail "отменено."

# Save what is currently in OneDrive so the restore can be undone
SAFETY_DIR="$BACKUP_DIR/before-restore"
SAFETY_FILE="$SAFETY_DIR/$(date +%Y-%m-%d_%H-%M-%S)-$(basename "$REMOTE_PATH")"
mkdir -p "$SAFETY_DIR"
chmod 700 "$SAFETY_DIR"
log "Сохраняю текущую версию: $SAFETY_FILE"
rclone copyto "$TARGET" "$SAFETY_FILE" || fail "не удалось скачать текущий файл. Ничего не изменено."
chmod 600 "$SAFETY_FILE"

log "Загружаю копию в OneDrive..."
rclone copyto --retries 1 "$BACKUP_FILE" "$TARGET" \
  || fail "загрузка не удалась (файл мог быть открыт в Excel). Текущая версия сохранена: $SAFETY_FILE"

local_hash="$(rclone hashsum quickxor "$BACKUP_FILE" | awk '{print $1}')"
remote_hash="$(rclone hashsum quickxor "$TARGET" | awk '{print $1}')"
[ "$local_hash" = "$remote_hash" ] \
  || fail "хеш в OneDrive не совпал с копией. Проверьте файл вручную. Прежняя версия: $SAFETY_FILE"

log "Готово. Файл в OneDrive восстановлен из копии."
log "Если нужно отменить, восстановите прежнюю версию: $0 \"$SAFETY_FILE\""
