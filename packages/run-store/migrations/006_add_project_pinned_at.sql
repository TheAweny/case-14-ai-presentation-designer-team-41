-- A project can be pinned in the sidebar. The moment of pinning orders the pinned ones, most
-- recent first; NULL means not pinned. Pinning is not an edit, so it leaves updated_at alone.
ALTER TABLE library_projects ADD COLUMN IF NOT EXISTS pinned_at timestamptz;
