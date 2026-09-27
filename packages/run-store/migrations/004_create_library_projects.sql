CREATE TABLE IF NOT EXISTS library_projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  appearance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS library_project_templates (
  project_id text NOT NULL REFERENCES library_projects(id) ON DELETE CASCADE,
  template_id text NOT NULL REFERENCES stored_files(id) ON DELETE CASCADE,
  attached_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, template_id)
);
