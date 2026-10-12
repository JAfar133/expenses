-- v3: how long a member may correct or delete their own expense (minutes; 0 = only the owner edits).
-- The default is a week; the owner changes it in the group settings.
ALTER TABLE groups
  ADD COLUMN member_edit_minutes integer NOT NULL DEFAULT 10080 CHECK (member_edit_minutes >= 0);
