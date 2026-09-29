-- Which models the connection from the server environment offers. It has no row in
-- model_connections, so its limit lives here, keyed by its address: another gateway in .env
-- starts unlimited instead of inheriting a list of someone else's model ids.
CREATE TABLE IF NOT EXISTS model_server_connection (
  base_url text PRIMARY KEY,
  enabled_models jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
