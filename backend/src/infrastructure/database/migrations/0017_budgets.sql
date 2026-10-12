-- v3: spending limits of a group. A limit is for one category or (category_id empty) for the whole group,
-- in the reporting currency of the group, for a period the owner chooses:
--   month: the calendar month; month_from_day: a month starting on `period_day` (1-28); week: Monday to Sunday.
CREATE TABLE budgets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     uuid          NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  category_id  uuid          REFERENCES categories (id) ON DELETE CASCADE,
  limit_amount numeric(14, 2) NOT NULL CHECK (limit_amount > 0),
  period_kind  text          NOT NULL CHECK (period_kind IN ('month', 'month_from_day', 'week')),
  period_day   smallint      CHECK (period_day BETWEEN 1 AND 28),
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now(),
  CHECK ((period_kind = 'month_from_day') = (period_day IS NOT NULL))
);
-- One limit per category and one overall limit per group
CREATE UNIQUE INDEX budgets_category_idx ON budgets (group_id, category_id) WHERE category_id IS NOT NULL;
CREATE UNIQUE INDEX budgets_total_idx ON budgets (group_id) WHERE category_id IS NULL;
