CREATE TABLE generation_builds (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  request_key text NOT NULL,
  spec_hash text NOT NULL,
  spec jsonb NOT NULL,
  variants jsonb NOT NULL,
  status text NOT NULL DEFAULT 'interrupted'
    CHECK (status IN ('running','interrupted','failed','stopped','done')),
  fence bigint NOT NULL DEFAULT 0,
  lease_until timestamptz,
  worker_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, request_key)
);

CREATE TABLE provider_attempts (
  id uuid PRIMARY KEY,
  build_id uuid REFERENCES generation_builds(id),
  owner_id text NOT NULL,
  task_key text NOT NULL,
  model_id text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  http_status int,
  input_tokens bigint,
  output_tokens bigint,
  reserved_tokens bigint NOT NULL,
  estimated_cost numeric,
  actual_cost numeric,
  pricing_version text,
  currency text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX provider_attempts_build_idx ON provider_attempts(build_id, created_at);

-- Same product run resumes; event sequences remain cumulative and completed variants stay done.
CREATE OR REPLACE FUNCTION enforce_run_state_transition() RETURNS trigger AS $$
BEGIN
  IF OLD.state = NEW.state THEN RETURN NEW; END IF;
  IF OLD.state = 'queued' AND NEW.state IN ('running', 'failed') THEN RETURN NEW; END IF;
  IF OLD.state = 'running' AND NEW.state IN ('done', 'failed') THEN RETURN NEW; END IF;
  IF OLD.state = 'failed' AND NEW.state = 'running' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'invalid run state transition from % to %', OLD.state, NEW.state
    USING ERRCODE = '23514', CONSTRAINT = 'runs_state_transition';
END;
$$ LANGUAGE plpgsql;
