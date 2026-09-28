CREATE TABLE user_model_connections (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name text NOT NULL,
  preset text NOT NULL,
  base_url text NOT NULL,
  api_key_ciphertext text,
  last_check jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX user_model_connections_user_id_idx ON user_model_connections(user_id, created_at);

CREATE TABLE user_model_role_assignments (
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('planner', 'writer', 'critic', 'vision', 'image')),
  kind text NOT NULL CHECK (kind IN ('model', 'disabled', 'unassigned')),
  connection_id text REFERENCES user_model_connections(id) ON DELETE SET NULL,
  model_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role),
  CHECK (
    (kind = 'model' AND connection_id IS NOT NULL AND model_id IS NOT NULL)
    OR (kind <> 'model' AND connection_id IS NULL AND model_id IS NULL)
  )
);
