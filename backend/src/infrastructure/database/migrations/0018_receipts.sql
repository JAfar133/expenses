-- v3: receipt photos. Off by default: the owner turns them on for the group and picks the categories
-- where a photo may be attached. The file itself lives in RECEIPTS_DIR; the table keeps what belongs to what.
ALTER TABLE groups ADD COLUMN receipts_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE categories ADD COLUMN receipts_allowed boolean NOT NULL DEFAULT false;

CREATE TABLE expense_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id   uuid        NOT NULL REFERENCES expenses (id),
  group_id     uuid        NOT NULL REFERENCES groups (id),
  -- Path inside RECEIPTS_DIR: <group>/<expense>/<id>.<ext>
  file_path    text        NOT NULL,
  content_type text        NOT NULL,
  size_bytes   integer     NOT NULL CHECK (size_bytes > 0),
  created_by   text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Soft delete: a replaced or removed photo stays on the disk, only the row is marked
  deleted_at   timestamptz
);
-- One current photo per expense
CREATE UNIQUE INDEX expense_attachments_current_idx ON expense_attachments (expense_id) WHERE deleted_at IS NULL;
