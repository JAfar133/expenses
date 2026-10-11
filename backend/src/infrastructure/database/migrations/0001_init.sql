-- Expenses. PostgreSQL stores all operations; Excel is a mirror maintained by sync.
CREATE TABLE expenses (
  id              uuid PRIMARY KEY,
  -- Strict insertion order (now() may coincide): the Excel queue follows it
  seq             bigint GENERATED ALWAYS AS IDENTITY,
  date            date        NOT NULL,
  card            text        NOT NULL,
  category        text        NOT NULL,
  name            text        NOT NULL,
  amount          integer     NOT NULL CHECK (amount > 0),

  -- Where the record came from: added in the app or discovered in Excel during sync
  source          text        NOT NULL CHECK (source IN ('app', 'excel')),

  -- State in Excel:
  --   pending — waiting to be written to Excel (queue)
  --   writing — Excel write started, result not confirmed yet
  --   synced  — the record is in Excel
  excel_status    text        NOT NULL CHECK (excel_status IN ('pending', 'writing', 'synced')),
  excel_attempts  integer     NOT NULL DEFAULT 0,
  excel_last_error text,
  excel_synced_at timestamptz,

  created_by      text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX expenses_date_idx ON expenses (date DESC);
-- Excel queue: only records that are not synced yet
CREATE INDEX expenses_excel_queue_idx ON expenses (seq) WHERE excel_status <> 'synced';

-- Duplicate protection: the key and the expense itself are saved in one transaction
CREATE TABLE idempotency_keys (
  user_id      text        NOT NULL,
  key          text        NOT NULL,
  request_hash text        NOT NULL,
  result       jsonb       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- Result of the last sync with Excel (one row)
CREATE TABLE sync_state (
  id          integer PRIMARY KEY CHECK (id = 1),
  last_result jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
