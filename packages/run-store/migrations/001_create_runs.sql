CREATE TYPE run_state AS ENUM ('queued', 'running', 'done', 'failed');

CREATE TABLE runs (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]*$'),
  state run_state NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX runs_state_created_at_idx ON runs(state, created_at DESC);

CREATE FUNCTION enforce_run_state_transition() RETURNS trigger AS $$
BEGIN
  IF OLD.state = NEW.state THEN
    RETURN NEW;
  END IF;

  IF OLD.state = 'queued' AND NEW.state IN ('running', 'failed') THEN
    RETURN NEW;
  END IF;

  IF OLD.state = 'running' AND NEW.state IN ('done', 'failed') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid run state transition from % to %', OLD.state, NEW.state
    USING ERRCODE = '23514', CONSTRAINT = 'runs_state_transition';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER runs_state_transition
BEFORE UPDATE OF state ON runs
FOR EACH ROW EXECUTE FUNCTION enforce_run_state_transition();
