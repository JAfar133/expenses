-- v5: messages that the owner of a group (to its members) or the administrator (to everyone) sends from the app.
-- A message is an ordinary notification (the bell and Web Push) of the type `announcement`; the log below lets the
-- sender see what was sent and to how many people. A recipient without a group still gets it, so group_id is optional.
ALTER TABLE notifications ALTER COLUMN group_id DROP NOT NULL;

CREATE TABLE notification_broadcasts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id  uuid        REFERENCES users (id) ON DELETE SET NULL,
  -- group: the sender's group; users: chosen people; all: every user (administrator only)
  scope      text        NOT NULL CHECK (scope IN ('group', 'users', 'all')),
  title      text        NOT NULL,
  body       text        NOT NULL,
  recipients integer     NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_broadcasts_sender_idx ON notification_broadcasts (sender_id, created_at DESC);

-- A new type of push: whoever saved their settings before has it on (messages from the owner should arrive)
UPDATE notification_settings SET push_types = array_append(push_types, 'announcement')
 WHERE NOT ('announcement' = ANY (push_types));
