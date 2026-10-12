-- v2, stage 4: money in the card's currency and in the group's reporting currency.
--
-- `amount` stays what it was: the amount in drams (whole), used by Excel and as the pivot for conversions.
-- New columns keep the same expense in the currency of its card and in the group's reporting currency, so that
-- groups and cards can live in other currencies. Amounts have two decimals (drams are stored with .00).
-- Rows written without these values (an import from Excel, old records) get them from the drams amount when
-- both currencies are drams; otherwise they stay empty and the readers fall back to `amount`.
ALTER TABLE expenses
  ADD COLUMN card_currency      text,
  ADD COLUMN card_amount        numeric(14, 2),
  ADD COLUMN reporting_currency text,
  ADD COLUMN reporting_amount   numeric(14, 2);

CREATE FUNCTION expenses_money_defaults() RETURNS trigger AS $$
DECLARE
  card_cur text;
  report_cur text;
BEGIN
  IF NEW.card_amount IS NULL AND NEW.card_id IS NOT NULL THEN
    SELECT c.currency, g.reporting_currency INTO card_cur, report_cur
      FROM cards c JOIN groups g ON g.id = c.group_id WHERE c.id = NEW.card_id;
    -- Only drams can be taken over as they are
    IF card_cur = 'AMD' AND report_cur = 'AMD' THEN
      NEW.card_currency := card_cur;
      NEW.card_amount := NEW.amount;
      NEW.reporting_currency := report_cur;
      NEW.reporting_amount := NEW.amount;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Sorts after expenses_assign_group_and_card and expenses_ensure_category: the card is known by then
CREATE TRIGGER expenses_money_defaults
  BEFORE INSERT ON expenses
  FOR EACH ROW EXECUTE FUNCTION expenses_money_defaults();

-- Records already assigned to a card
UPDATE expenses e
   SET card_currency = c.currency, card_amount = e.amount,
       reporting_currency = g.reporting_currency, reporting_amount = e.amount
  FROM cards c JOIN groups g ON g.id = c.group_id
 WHERE c.id = e.card_id AND c.currency = 'AMD' AND g.reporting_currency = 'AMD';
