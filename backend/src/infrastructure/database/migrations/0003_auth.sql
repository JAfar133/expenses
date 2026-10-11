-- Пользователи приложения и их сессии (вход по логину и паролю).

CREATE TABLE users (
  id            uuid PRIMARY KEY,
  username      text        NOT NULL UNIQUE CHECK (username = lower(username)),
  -- Имя для интерфейса
  display_name  text        NOT NULL,
  -- Карта по умолчанию: подставляется в форму расхода после входа
  card          text        NOT NULL,
  -- Хеш пароля (scrypt). NULL — пароль ещё не задан, войти нельзя
  password_hash text,
  disabled_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Сессия = один вход с одного устройства. Токены в базе не хранятся, только их SHA-256.
CREATE TABLE auth_sessions (
  id                    uuid PRIMARY KEY,
  user_id               uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  access_hash           text        NOT NULL,
  access_expires_at     timestamptz NOT NULL,

  refresh_hash          text        NOT NULL,
  refresh_expires_at    timestamptz NOT NULL,
  -- Предыдущий refresh-токен: нужен, чтобы отличить гонку двух вкладок от кражи токена
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
