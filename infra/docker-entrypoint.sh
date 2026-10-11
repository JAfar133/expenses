#!/bin/sh
# Точка входа backend-контейнера: готовит конфигурацию rclone и запускает сервер.
set -eu

RCLONE_DIR=/data/rclone
mkdir -p "$RCLONE_DIR" /data/backups

# Конфигурация rclone приходит как секрет (только для чтения). rclone обновляет в ней OAuth-токены,
# поэтому работаем с копией в томе: токен переживает перезапуски контейнера.
if [ ! -s "$RCLONE_DIR/rclone.conf" ] && [ -s /run/secrets/rclone.conf ]; then
  cp /run/secrets/rclone.conf "$RCLONE_DIR/rclone.conf"
  chmod 600 "$RCLONE_DIR/rclone.conf"
fi

# Excel в OneDrive необязателен: без rclone.conf или без ONEDRIVE_FILE_PATH сервер всё равно запускается
if [ -n "${ONEDRIVE_FILE_PATH:-}" ] && [ ! -s "$RCLONE_DIR/rclone.conf" ]; then
  echo "Предупреждение: ONEDRIVE_FILE_PATH задан, но secrets/rclone.conf пуст или не найден: синхронизация с Excel работать не будет." >&2
fi

export RCLONE_CONFIG="$RCLONE_DIR/rclone.conf"
exec node dist/server.js
