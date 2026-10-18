-- What a model of a connection can do, by the connection and its address instead of the address
-- alone. Keyed by address, a person's own connection to the same server as a shared one could
-- rewrite how everyone's models think and which of them the pickers offer. Nothing is carried
-- over from model_capabilities: thinking is probed again for free, kinds set by hand are set
-- again. The old table stays for an image rolled back to read.
CREATE TABLE IF NOT EXISTS model_connection_capabilities (
  connection_id text NOT NULL,
  -- The address the finding speaks of: a connection moved to another server starts afresh.
  base_url text NOT NULL,
  model_id text NOT NULL,
  -- {"toggle": "enable-thinking" | "reasoning-effort" | null, "levels": boolean}
  reasoning jsonb,
  manual_kinds jsonb,
  probe_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, base_url, model_id)
);
