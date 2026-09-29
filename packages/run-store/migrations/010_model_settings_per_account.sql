-- Model connections and role assignments per account. A row without an owner is shared with
-- everyone: an administrator set it up, the way every row was installation-wide until now. A
-- person's own connections and role choices have their owner and go with the account.
ALTER TABLE model_connections
  ADD COLUMN IF NOT EXISTS owner_id text REFERENCES app_users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS model_connections_owner_idx ON model_connections(owner_id, created_at);

ALTER TABLE model_role_assignments
  ADD COLUMN IF NOT EXISTS owner_id text REFERENCES app_users(id) ON DELETE CASCADE;

-- One assignment per role for everyone, and one per role for each account.
ALTER TABLE model_role_assignments DROP CONSTRAINT IF EXISTS model_role_assignments_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS model_role_assignments_role_owner_idx
  ON model_role_assignments (role, COALESCE(owner_id, ''));
