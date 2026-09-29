-- Which models of a connection stay available. NULL means every model the last check reported,
-- so a connection added before this column keeps offering its whole list.
ALTER TABLE model_connections
  ADD COLUMN IF NOT EXISTS enabled_models jsonb;
