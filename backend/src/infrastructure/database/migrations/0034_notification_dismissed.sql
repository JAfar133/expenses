-- v5: a person can hide notifications (one, or all). A hidden row stays in the table (its dedupe key keeps the same
-- event from coming back) but is not shown or counted; it can be restored right after hiding (undo).
ALTER TABLE notifications ADD COLUMN dismissed_at timestamptz;
DROP INDEX notifications_unread_idx;
CREATE INDEX notifications_unread_idx ON notifications (user_id)
  WHERE read_at IS NULL AND dismissed_at IS NULL;
