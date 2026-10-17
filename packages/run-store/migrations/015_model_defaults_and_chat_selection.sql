-- A role can explicitly follow the primary model, including over an administrator's override.
ALTER TABLE model_role_assignments DROP CONSTRAINT model_role_assignments_kind_check;
ALTER TABLE model_role_assignments ADD CONSTRAINT model_role_assignments_kind_check
  CHECK (kind IN ('model', 'disabled', 'default'));

-- Independent of streamed messages: changing the next model cannot be overwritten by a save.
ALTER TABLE chats ADD COLUMN model jsonb;
