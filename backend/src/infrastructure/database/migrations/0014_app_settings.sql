-- v2: settings of the whole application that an administrator changes in the app (key -> JSON value).
-- excel_sync_enabled: turns the Excel/OneDrive sync on or off; without a row it follows the server configuration
-- (on when ONEDRIVE_FILE_PATH is set).
CREATE TABLE app_settings (
  key        text        PRIMARY KEY,
  value      jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
