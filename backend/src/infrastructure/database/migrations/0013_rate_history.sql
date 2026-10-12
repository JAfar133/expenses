-- v2: the rate of every day, so that a recalculation can use the rate of the day of the expense.
-- One row per currency and day: the last rate received that day. The current rates stay in exchange_rates.
CREATE TABLE exchange_rate_history (
  currency   text           NOT NULL,
  date       date           NOT NULL,
  rate       numeric(18, 6) NOT NULL CHECK (rate > 0),
  fetched_at timestamptz    NOT NULL,
  PRIMARY KEY (currency, date)
);

-- The rates known now are the first entries
INSERT INTO exchange_rate_history (currency, date, rate, fetched_at)
SELECT currency, (fetched_at AT TIME ZONE 'UTC')::date, rate, fetched_at FROM exchange_rates
ON CONFLICT DO NOTHING;
