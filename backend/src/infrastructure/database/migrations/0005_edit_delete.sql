-- Editing and deleting expenses in the app, propagated to Excel.
--
-- excel_snapshot: how this record's row currently looks in Excel (date, card, category, name, cost).
-- Empty if the record is not in Excel. Reconciliation uses the snapshot to match Excel rows to records, so an edit in the app
-- does not look like "old one deleted + new one added". What must be done in Excel is derived from the state:
--   no snapshot, record active        → append the row
--   snapshot exists and differs       → replace the row
--   snapshot exists, record deleted   → remove the row
ALTER TABLE expenses
  ADD COLUMN excel_snapshot jsonb,
  ADD COLUMN updated_by text;

-- Active records already in Excel: the Excel row equals the current values
UPDATE expenses
   SET excel_snapshot = jsonb_build_object(
         'date', to_char(date, 'YYYY-MM-DD'),
         'card', card,
         'category', category,
         'name', name,
         'amount', amount)
 WHERE excel_status = 'synced' AND deleted_at IS NULL;

-- Change log: who changed what and when (values before and after)
CREATE TABLE expense_changes (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expense_id  uuid        NOT NULL REFERENCES expenses (id) ON DELETE CASCADE,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  changed_by  text        NOT NULL,
  action      text        NOT NULL CHECK (action IN ('update', 'delete', 'restore')),
  before      jsonb,
  after       jsonb
);

CREATE INDEX expense_changes_expense_idx ON expense_changes (expense_id, id);
