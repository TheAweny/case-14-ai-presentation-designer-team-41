-- Accounts get a role and can be switched off, and everything a person makes belongs to them.
-- Rows made before this migration have no owner and nobody sees them: the installation starts
-- its library afresh under accounts.

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz;

-- A project goes with its owner.
ALTER TABLE library_projects
  ADD COLUMN IF NOT EXISTS owner_id text REFERENCES app_users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS library_projects_owner_idx ON library_projects(owner_id, updated_at DESC);

-- Templates and content files. A template an administrator shares is seen by everyone and
-- outlives its owner: the account goes, the template stays without one. Deleting a template
-- hides it from the library; decks laid out with it keep their file.
ALTER TABLE stored_files
  ADD COLUMN IF NOT EXISTS owner_id text REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS stored_files_owner_idx ON stored_files(owner_id, kind, created_at DESC);
