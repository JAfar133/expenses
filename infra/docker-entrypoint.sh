#!/bin/sh
# Точка входа backend-контейнера: готовит конфигурацию rclone и запускает сервер.
set -eu

RCLONE_DIR=/data/rclone
mkdir -p "$RCLONE_DIR" /data/backups

# Конфигурация rclone приходит как секрет (только для чтения). rclone обновляет в ней OAuth-токены,
# поэтому работаем с копией в томе: токен переживает перезапуски контейнера.
if [ ! -f "$RCLONE_DIR/rclone.conf" ] && [ -f /run/secrets/rclone.conf ]; then
  cp /run/secrets/rclone.conf "$RCLONE_DIR/rclone.conf"
  chmod 600 "$RCLONE_DIR/rclone.conf"
fi

if [ ! -f "$RCLONE_DIR/rclone.conf" ]; then
  echo "Не найден rclone.conf. Положите файл в secrets/rclone.conf (см. README)." >&2
  exit 1
fi

export RCLONE_CONFIG="$RCLONE_DIR/rclone.conf"
exec node dist/server.js
