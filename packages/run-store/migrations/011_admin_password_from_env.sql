-- The ADMIN_PASSWORD from .env last applied to the account, as a bcrypt hash. A different password
-- in .env replaces the account's password at the next start: that is how a forgotten
-- administrator password is reset. While .env keeps the same one, the password changed in the
-- interface stays. NULL — not known yet: the next start only records it.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS env_password_hash text;
