-- Personal account settings: name, default card, time zone and the edit permission.
-- custom_*: the user's own choice; empty means "as set in the configuration" (default).
-- The defaults (card, timezone_default, can_edit_default) are refreshed from .env on every start,
-- while the personal choice stays on top of them.
ALTER TABLE users
  ADD COLUMN custom_display_name text,
  ADD COLUMN custom_card text,
  ADD COLUMN custom_timezone text,
  ADD COLUMN timezone_default text NOT NULL DEFAULT 'UTC',
  ADD COLUMN can_edit_default boolean NOT NULL DEFAULT false,
  ADD COLUMN can_edit_override boolean;
