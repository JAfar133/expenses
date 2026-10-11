-- Expenses in a foreign currency: amount is always the amount in drams (it goes to Excel), while the original amount,
-- currency and rate at entry time are stored separately. For old records and dram records these fields are empty.
ALTER TABLE expenses
  ADD COLUMN original_amount   numeric(14, 2),
  ADD COLUMN original_currency text,
  ADD COLUMN exchange_rate     numeric(18, 6),
  ADD CONSTRAINT expenses_original_consistent CHECK (
    (original_amount IS NULL) = (original_currency IS NULL)
    AND (original_amount IS NULL) = (exchange_rate IS NULL)
  );

-- Latest known rates (drams per unit of currency): a fallback if the rate source is unavailable
CREATE TABLE exchange_rates (
  currency   text          PRIMARY KEY,
  rate       numeric(18, 6) NOT NULL CHECK (rate > 0),
  fetched_at timestamptz   NOT NULL
);
