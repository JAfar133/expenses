-- v2, stage 3: invitations to a group and users that do not come from the server settings.

-- Users created from an invitation are not listed in AUTH_USERS: the sync with the settings must not disable them
ALTER TABLE users ADD COLUMN from_env boolean NOT NULL DEFAULT true;

-- kind 'join': a new user joins the group with the given role;
-- kind 'reset': an existing user sets a new password (a forgotten one).
-- The token itself is shown once and never stored, only its hash.
CREATE TABLE invitations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text        NOT NULL CHECK (kind IN ('join', 'reset')),
  group_id   uuid        REFERENCES groups (id) ON DELETE CASCADE,
  role       text        CHECK (role IN ('owner', 'member')),
  user_id    uuid        REFERENCES users (id) ON DELETE CASCADE,
  token_hash text        NOT NULL UNIQUE,
  created_by uuid        REFERENCES users (id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'join' AND group_id IS NOT NULL AND role IS NOT NULL AND user_id IS NULL)
    OR (kind = 'reset' AND user_id IS NOT NULL)
  )
);
CREATE INDEX invitations_group_idx ON invitations (group_id);
