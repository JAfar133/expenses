-- v4: expense items (positions of a receipt) and receipt parsing by an LLM.
-- Off by default: the administrator turns the AI on for the installation, the owner for the group.

-- Group switch and the group's own daily limit of parsings (NULL: the installation default applies)
ALTER TABLE groups ADD COLUMN ai_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE groups ADD COLUMN ai_daily_limit integer CHECK (ai_daily_limit >= 0);

-- Where the name and the date of an expense came from:
-- default: the form's own value (the person did not touch it), manual: typed by a person, ai: filled by the AI.
-- Existing expenses are manual, so the AI never rewrites them.
ALTER TABLE expenses ADD COLUMN name_source text NOT NULL DEFAULT 'manual'
  CHECK (name_source IN ('default', 'manual', 'ai'));
ALTER TABLE expenses ADD COLUMN date_source text NOT NULL DEFAULT 'manual'
  CHECK (date_source IN ('default', 'manual', 'ai'));
-- The receipt of the expense was parsed by the AI (stays even when a person fixes every field later)
ALTER TABLE expenses ADD COLUMN ai_processed_at timestamptz;
ALTER TABLE expenses ADD COLUMN ai_model text;

CREATE TABLE expense_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid          NOT NULL REFERENCES expenses (id),
  group_id   uuid          NOT NULL REFERENCES groups (id),
  position   integer       NOT NULL,
  name       text          NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  price      numeric(14,2) NOT NULL CHECK (price >= 0),
  quantity   numeric(10,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  source     text          NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai')),
  created_at timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX expense_items_expense_idx ON expense_items (expense_id, position);

-- Every parsing attempt: the daily limit and the statistics for the administrator
CREATE TABLE ai_usage (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid        NOT NULL REFERENCES groups (id),
  expense_id uuid        REFERENCES expenses (id),
  task       text        NOT NULL,
  model      text        NOT NULL,
  status     text        NOT NULL CHECK (status IN ('ok', 'error')),
  error_code text,
  created_by text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_group_day_idx ON ai_usage (group_id, created_at);
