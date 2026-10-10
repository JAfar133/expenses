-- Расходы. PostgreSQL хранит все операции; Excel — зеркало, которое поддерживается синхронизацией.
CREATE TABLE expenses (
  id              uuid PRIMARY KEY,
  -- Строгий порядок добавления (время now() может совпасть): по нему идёт очередь в Excel
  seq             bigint GENERATED ALWAYS AS IDENTITY,
  date            date        NOT NULL,
  card            text        NOT NULL,
  category        text        NOT NULL,
  name            text        NOT NULL,
  amount          integer     NOT NULL CHECK (amount > 0),

  -- Откуда взята запись: добавлена в приложении или обнаружена в Excel при синхронизации
  source          text        NOT NULL CHECK (source IN ('app', 'excel')),

  -- Состояние в Excel:
  --   pending — ждёт записи в Excel (очередь)
  --   writing — запись в Excel начата, результат ещё не подтверждён
  --   synced  — запись есть в Excel
  excel_status    text        NOT NULL CHECK (excel_status IN ('pending', 'writing', 'synced')),
  excel_attempts  integer     NOT NULL DEFAULT 0,
  excel_last_error text,
  excel_synced_at timestamptz,

  created_by      text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX expenses_date_idx ON expenses (date DESC);
-- Очередь в Excel: только записи, которые ещё не синхронизированы
CREATE INDEX expenses_excel_queue_idx ON expenses (seq) WHERE excel_status <> 'synced';

-- Защита от дублей: ключ и сам расход сохраняются в одной транзакции
CREATE TABLE idempotency_keys (
  user_id      text        NOT NULL,
  key          text        NOT NULL,
  request_hash text        NOT NULL,
  result       jsonb       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- Результат последней синхронизации с Excel (одна строка)
CREATE TABLE sync_state (
  id          integer PRIMARY KEY CHECK (id = 1),
  last_result jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
