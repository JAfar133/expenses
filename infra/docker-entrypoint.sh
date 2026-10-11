#!/bin/sh
# Backend container entrypoint: prepares the rclone config and starts the server.
set -eu

RCLONE_DIR=/data/rclone
mkdir -p "$RCLONE_DIR" /data/backups

# The rclone config arrives as a secret (read-only). rclone updates OAuth tokens in it,
# so we work with a copy in the volume: the token survives container restarts.
if [ ! -s "$RCLONE_DIR/rclone.conf" ] && [ -s /run/secrets/rclone.conf ]; then
  cp /run/secrets/rclone.conf "$RCLONE_DIR/rclone.conf"
  chmod 600 "$RCLONE_DIR/rclone.conf"
fi

# Excel in OneDrive is optional: without rclone.conf or ONEDRIVE_FILE_PATH the server still starts
if [ -n "${ONEDRIVE_FILE_PATH:-}" ] && [ ! -s "$RCLONE_DIR/rclone.conf" ]; then
  echo "Предупреждение: ONEDRIVE_FILE_PATH задан, но secrets/rclone.conf пуст или не найден: синхронизация с Excel работать не будет." >&2
fi

export RCLONE_CONFIG="$RCLONE_DIR/rclone.conf"
exec node dist/server.js
