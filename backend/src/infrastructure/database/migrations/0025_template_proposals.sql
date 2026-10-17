-- v5: a member does not publish a template to the group: they propose it. The proposal is a separate group template
-- (`status = 'proposed'`, invisible to the group until the owner of the group makes it active) that remembers the personal
-- template it was copied from (`origin_id`). The personal template stays with its author and changes independently.
ALTER TABLE expense_templates
  ADD COLUMN status    text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'proposed')),
  ADD COLUMN origin_id uuid REFERENCES expense_templates (id) ON DELETE SET NULL,
  ADD CONSTRAINT expense_templates_proposal_scope CHECK (status = 'active' OR scope = 'group');
CREATE INDEX expense_templates_origin_idx ON expense_templates (origin_id) WHERE origin_id IS NOT NULL;
