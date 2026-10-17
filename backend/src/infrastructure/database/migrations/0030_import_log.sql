-- v5: a diagnostic log of every authorised import request: the whole JSON as it came (unknown fields too), what
-- the server made of it and what it decided. Kept for 30 days (the daily maintenance removes older rows).
CREATE TABLE import_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  key_id      uuid        REFERENCES api_keys (id) ON DELETE SET NULL,
  source      text        NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb       NOT NULL,
  -- created | duplicate | merged | unrecognized | parse_error | unsupported | card_not_found | card_ambiguous
  -- | unknown_source | error
  status      text        NOT NULL,
  error       text,
  -- What was read from the request: amount, currency, merchant, time, card hints
  parsed      jsonb,
  -- How a duplicate was recognised: which earlier operation it was taken for and why
  match       jsonb,
  expense_id  uuid        REFERENCES expenses (id) ON DELETE SET NULL
);
CREATE INDEX import_log_group_idx ON import_log (group_id, received_at DESC);
