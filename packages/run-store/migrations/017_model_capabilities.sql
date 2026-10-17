-- What a model can do, learnt by asking it (apps/api/src/models/capability-probe.ts), by the server
-- address and the model id: a name says nothing reliable, and the same model behind the same address
-- answers the same way whoever asks. NULL in a column: that question has not been settled yet.
CREATE TABLE IF NOT EXISTS model_capabilities (
  base_url text NOT NULL,
  model_id text NOT NULL,
  -- {"toggle": "enable-thinking" | "reasoning-effort" | null, "levels": boolean}
  reasoning jsonb,
  speech boolean,
  probe_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (base_url, model_id)
);
