-- v5: expenses from bank push notifications (iOS Shortcuts). A card is matched by the last four digits; a key
-- is bound to a group and can only import; every attempt is kept (the raw text only for diagnostics).
ALTER TABLE cards ADD COLUMN last4 text CHECK (last4 ~ '^[0-9]{4}$');

CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     uuid        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  -- The imported expenses are made on behalf of this user (and with their rights to cards)
  created_by   uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         text        NOT NULL,
  scope        text        NOT NULL DEFAULT 'import' CHECK (scope IN ('import')),
  -- Only the hash is stored; the prefix is shown to recognise a key
  key_prefix   text        NOT NULL,
  key_hash     text        NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX api_keys_group_idx ON api_keys (group_id);

CREATE TABLE bank_imports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  key_id      uuid        REFERENCES api_keys (id) ON DELETE SET NULL,
  source      text        NOT NULL,
  -- created | parse_error | unsupported | card_not_found | card_ambiguous | error
  status      text        NOT NULL,
  error_code  text,
  -- Identifies one real operation: a repeat of a created one is a duplicate
  fingerprint text,
  expense_id  uuid        REFERENCES expenses (id) ON DELETE SET NULL,
  merchant    text,
  amount      numeric(14, 2),
  currency    text,
  card_last4  text,
  occurred_at timestamptz,
  title       text,
  body        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bank_imports_created_uniq ON bank_imports (group_id, fingerprint)
  WHERE status = 'created';
CREATE INDEX bank_imports_group_idx ON bank_imports (group_id, created_at DESC);
