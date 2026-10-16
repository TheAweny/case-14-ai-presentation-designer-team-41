-- The picture of an account: NULL — the abstract mark its id gives it, 'preset:N' — one of the
-- marks picked by hand, or a small image the person uploaded, as a data URL the browser made.
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS avatar text;
