ALTER TABLE stored_files DROP CONSTRAINT stored_files_kind_check;
ALTER TABLE stored_files ADD CONSTRAINT stored_files_kind_check
  CHECK (kind IN ('template', 'content', 'artifact', 'brandbook'));
