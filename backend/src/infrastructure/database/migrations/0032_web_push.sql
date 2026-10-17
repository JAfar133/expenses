-- v5: Web Push. A subscription belongs to a device and browser (a person has several); its endpoint and keys are a
-- secret that lets the server wake that device, so they are never logged or returned. Settings are per person.
CREATE TABLE push_subscriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint         text        NOT NULL UNIQUE,
  p256dh           text        NOT NULL,
  auth             text        NOT NULL,
  -- «iPhone · Safari (приложение)»: shown in the list of devices
  label            text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_success_at  timestamptz,
  -- Consecutive failures that were not «gone»: after ten the subscription is dropped
  failures         integer     NOT NULL DEFAULT 0
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

-- No row: the defaults (expenses and import problems yes, a parsed receipt no; amounts shown)
CREATE TABLE notification_settings (
  user_id           uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  push_types        text[]  NOT NULL,
  push_hide_amounts boolean NOT NULL DEFAULT false,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
