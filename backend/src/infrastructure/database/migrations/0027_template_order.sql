-- v5: every user may arrange the templates they see (their own and the group's) in their own order. A template
-- without a row here follows the default order: group templates first (the owner's order), then the personal ones.
CREATE TABLE template_order (
  user_id     uuid    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  template_id uuid    NOT NULL REFERENCES expense_templates (id) ON DELETE CASCADE,
  position    integer NOT NULL,
  PRIMARY KEY (user_id, template_id)
);
