CREATE TABLE run_events (
  run_id text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence >= 0),
  stage text NOT NULL,
  status text NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, sequence)
);

CREATE TABLE artifacts (
  id uuid PRIMARY KEY,
  run_id text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  variant_id text,
  kind text NOT NULL,
  storage_key text NOT NULL,
  sha256 char(64) CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, storage_key)
);

CREATE INDEX artifacts_run_id_idx ON artifacts(run_id);
