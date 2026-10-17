-- v5: who changed a template last (null: never changed after it was made); shown next to the author.
ALTER TABLE expense_templates ADD COLUMN updated_by uuid REFERENCES users (id) ON DELETE SET NULL;
