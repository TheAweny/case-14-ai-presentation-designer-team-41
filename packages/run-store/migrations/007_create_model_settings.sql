-- Connections to model servers added from the interface, and which model performs each role.
-- The key of a connection is stored only as AES-256-GCM ciphertext under MODEL_KEYS_SECRET
-- (apps/api/src/models/key-vault.ts); the plaintext never reaches this database.
CREATE TABLE IF NOT EXISTS model_connections (
  id text PRIMARY KEY,
  name text NOT NULL,
  preset text NOT NULL,
  base_url text NOT NULL,
  api_key_encrypted text,
  last_check jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A role absent here is not assigned. connection_id has no foreign key: the connection configured
-- through the server environment is not a row of model_connections.
CREATE TABLE IF NOT EXISTS model_role_assignments (
  role text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('model', 'disabled')),
  connection_id text,
  model_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Who changed model settings and when. Never the key: only what was done to which connection.
CREATE TABLE IF NOT EXISTS model_settings_events (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_id text,
  action text NOT NULL,
  connection_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
