-- App users and their sessions (login by username and password).

CREATE TABLE users (
  id            uuid PRIMARY KEY,
  username      text        NOT NULL UNIQUE CHECK (username = lower(username)),
  -- Name for the UI
  display_name  text        NOT NULL,
  -- Default card: pre-filled in the expense form after login
  card          text        NOT NULL,
  -- Password hash (scrypt). NULL — no password set yet, login is impossible
  password_hash text,
  disabled_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- A session = one login from one device. Tokens are not stored in the database, only their SHA-256.
CREATE TABLE auth_sessions (
  id                    uuid PRIMARY KEY,
  user_id               uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  access_hash           text        NOT NULL,
  access_expires_at     timestamptz NOT NULL,

  refresh_hash          text        NOT NULL,
  refresh_expires_at    timestamptz NOT NULL,
  -- Previous refresh token: needed to tell a race between two tabs from token theft
  previous_refresh_hash text,
  rotated_at            timestamptz,

  user_agent            text,
  ip                    text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_used_at          timestamptz NOT NULL DEFAULT now(),
  revoked_at            timestamptz
);

CREATE UNIQUE INDEX auth_sessions_access_hash_idx ON auth_sessions (access_hash);
CREATE INDEX auth_sessions_refresh_hash_idx ON auth_sessions (refresh_hash);
CREATE INDEX auth_sessions_previous_refresh_hash_idx ON auth_sessions (previous_refresh_hash)
  WHERE previous_refresh_hash IS NOT NULL;
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id);
