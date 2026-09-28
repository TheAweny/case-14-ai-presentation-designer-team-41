CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE app_users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_users (id, email, name, password_hash)
VALUES (
  'admin@example.com',
  'admin@example.com',
  'Administrator',
  crypt('123123', gen_salt('bf'))
)
ON CONFLICT (email) DO NOTHING;

CREATE TABLE stored_files (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('template', 'content', 'artifact')),
  file_name text NOT NULL,
  storage_path text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  profile jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stored_files_kind_created_at_idx ON stored_files(kind, created_at DESC);

CREATE TABLE library_projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  appearance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE library_project_templates (
  project_id text NOT NULL REFERENCES library_projects(id) ON DELETE CASCADE,
  template_id text NOT NULL REFERENCES stored_files(id) ON DELETE CASCADE,
  attached_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, template_id)
);
