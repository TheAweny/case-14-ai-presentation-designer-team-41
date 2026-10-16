-- Headers a connection sends besides the key, such as a gateway's Project-ID: a list of
-- {name, value}. A connection added before this column sends none.
ALTER TABLE model_connections
  ADD COLUMN IF NOT EXISTS headers jsonb NOT NULL DEFAULT '[]'::jsonb;
