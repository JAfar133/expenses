-- Расходы в иностранной валюте: в amount всегда сумма в драммах (она идёт в Excel), а исходная сумма,
-- валюта и курс на момент ввода хранятся отдельно. У старых записей и записей в драммах эти поля пусты.
ALTER TABLE expenses
  ADD COLUMN original_amount   numeric(14, 2),
  ADD COLUMN original_currency text,
  ADD COLUMN exchange_rate     numeric(18, 6),
  ADD CONSTRAINT expenses_original_consistent CHECK (
    (original_amount IS NULL) = (original_currency IS NULL)
    AND (original_amount IS NULL) = (exchange_rate IS NULL)
  );

-- Последние известные курсы (драммы за единицу валюты): запасной вариант, если источник курса недоступен
CREATE TABLE exchange_rates (
  currency   text          PRIMARY KEY,
  rate       numeric(18, 6) NOT NULL CHECK (rate > 0),
  fetched_at timestamptz   NOT NULL
);
