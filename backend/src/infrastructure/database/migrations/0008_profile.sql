-- Личные настройки аккаунта: имя, карта по умолчанию, часовой пояс и право правки.
-- custom_*: выбор самого пользователя; пусто означает «как задано в конфигурации» (default).
-- Значения по умолчанию (card, timezone_default, can_edit_default) обновляются из .env при каждом запуске,
-- а личный выбор остаётся поверх них.
ALTER TABLE users
  ADD COLUMN custom_display_name text,
  ADD COLUMN custom_card text,
  ADD COLUMN custom_timezone text,
  ADD COLUMN timezone_default text NOT NULL DEFAULT 'UTC',
  ADD COLUMN can_edit_default boolean NOT NULL DEFAULT false,
  ADD COLUMN can_edit_override boolean;
