-- User interface settings (chart types, etc.): stored on the server so the choice is the same on all devices.
ALTER TABLE users ADD COLUMN preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
