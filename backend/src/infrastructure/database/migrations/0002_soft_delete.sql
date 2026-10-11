-- Soft delete: a record that disappeared from Excel is marked deleted but stays in the database.
-- This way any mistake (e.g. Excel replaced with an old copy) can be corrected.
ALTER TABLE expenses
  ADD COLUMN deleted_at     timestamptz,
  -- Why the record was deleted: excel — the row was deleted or changed in Excel during sync
  ADD COLUMN deleted_reason text,
  ADD CONSTRAINT expenses_deleted_consistent CHECK ((deleted_at IS NULL) = (deleted_reason IS NULL));

-- Active (non-deleted) records: lists and categories are built from them
CREATE INDEX expenses_active_date_idx ON expenses (date DESC) WHERE deleted_at IS NULL;
