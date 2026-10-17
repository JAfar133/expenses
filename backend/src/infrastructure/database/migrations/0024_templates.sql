-- v5: quick-action templates. A template is a ready expense (category, card, name, optionally amount) behind one tap.
-- Personal ones belong to their author; group ones are visible to everyone in the group. Nothing is erased: removing
-- a template sets `archived_at`. Every user may hide group templates for themselves (`template_hidden`).
CREATE TABLE expense_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     uuid           NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  owner_id     uuid           NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  scope        text           NOT NULL CHECK (scope IN ('personal', 'group')),
  name         text           NOT NULL,
  emoji        text,
  category_id  uuid           NOT NULL REFERENCES categories (id),
  -- Empty: the user's default card is taken when the template is used
  card_id      uuid           REFERENCES cards (id) ON DELETE SET NULL,
  expense_name text           NOT NULL,
  amount       numeric(14, 2) CHECK (amount > 0),
  currency     text,
  sort_order   integer        NOT NULL DEFAULT 0,
  archived_at  timestamptz,
  created_at   timestamptz    NOT NULL DEFAULT now(),
  updated_at   timestamptz    NOT NULL DEFAULT now(),
  CHECK (amount IS NOT NULL OR currency IS NULL)
);
CREATE INDEX expense_templates_group_idx ON expense_templates (group_id) WHERE archived_at IS NULL;

CREATE TABLE template_hidden (
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES expense_templates (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, template_id)
);
