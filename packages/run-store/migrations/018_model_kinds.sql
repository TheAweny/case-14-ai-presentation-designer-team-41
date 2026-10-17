-- What each model is, learnt when its connection is added or checked (capability-probe.ts): it
-- chats, it reads pictures, it draws, it transcribes. NULL: not settled yet. The findings stay
-- until the connection is checked again.
ALTER TABLE model_capabilities ADD COLUMN IF NOT EXISTS chat boolean;
ALTER TABLE model_capabilities ADD COLUMN IF NOT EXISTS vision boolean;
ALTER TABLE model_capabilities ADD COLUMN IF NOT EXISTS image boolean;
