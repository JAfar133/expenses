-- Passwords can be changed in the app. So that a password from .env does not overwrite the one the user chose on every start,
-- we remember the hash of the last applied .env password: while the .env value is unchanged, the user's password stays.
-- If the .env value changed, the administrator is resetting the password, and .env wins.
ALTER TABLE users ADD COLUMN env_password_hash text;
