ALTER TABLE run_events
  ADD COLUMN IF NOT EXISTS payload jsonb;

UPDATE run_events
SET payload = jsonb_build_object(
  'schemaVersion', 1,
  'runId', run_id,
  'seq', sequence,
  'at', created_at,
  'type', CASE status
    WHEN 'started' THEN 'stage-started'
    WHEN 'completed' THEN 'stage-finished'
    ELSE 'failed'
  END,
  'stage', stage,
  'durationMs', 0,
  'code', 'internal',
  'retryable', false,
  'message', COALESCE(message, '')
)
WHERE payload IS NULL;

ALTER TABLE run_events
  ALTER COLUMN payload SET NOT NULL;
