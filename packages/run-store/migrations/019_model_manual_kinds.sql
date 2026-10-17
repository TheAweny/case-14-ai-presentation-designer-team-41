-- Model kinds come from the provider's own description in /models (kept with the connection
-- check), not from requests to each model: those cost money. What remains per model is the kind
-- the person set by hand and whether the server reads reasoning_effort.
ALTER TABLE model_capabilities ADD COLUMN IF NOT EXISTS manual_kinds jsonb;
ALTER TABLE model_capabilities DROP COLUMN IF EXISTS chat;
ALTER TABLE model_capabilities DROP COLUMN IF EXISTS vision;
ALTER TABLE model_capabilities DROP COLUMN IF EXISTS image;
ALTER TABLE model_capabilities DROP COLUMN IF EXISTS speech;
