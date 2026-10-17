-- v5: the notification feed of the app (the bell). One row per person who should see it. Later channels (Web Push,
-- Telegram) are fed from the same events. A row with a dedupe key exists once per person: the same event never
-- appears twice (a purchase reported by both IDBank and Wallet is one notification).
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  group_id   uuid        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  -- expense_imported | import_problem | receipt_parsed
  type       text        NOT NULL,
  title      text        NOT NULL,
  body       text        NOT NULL DEFAULT '',
  -- Where a tap goes (a path of the app)
  link       text,
  data       jsonb,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
CREATE UNIQUE INDEX notifications_dedupe_uniq ON notifications (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
