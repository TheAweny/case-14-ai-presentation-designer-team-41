-- Durable editor snapshots. Slide JSON lives here; picture bytes live on the filesystem.
-- Dropping the four tables rolls the feature back. Existing generated decks are untouched.

CREATE TABLE IF NOT EXISTS editor_snapshots (
  account_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  deck_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  base text NOT NULL,
  slides jsonb NOT NULL,
  media jsonb NOT NULL,
  content_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, deck_id, revision)
);

CREATE TABLE IF NOT EXISTS editor_conflicts (
  id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  deck_id text NOT NULL,
  expected_revision integer NOT NULL,
  base text NOT NULL,
  slides jsonb NOT NULL,
  media jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS editor_conflicts_deck_idx
  ON editor_conflicts(account_id, deck_id, created_at DESC);

CREATE TABLE IF NOT EXISTS editor_idempotency (
  account_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  deck_id text NOT NULL,
  idempotency_key uuid NOT NULL,
  outcome jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, deck_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS editor_media (
  account_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  deck_id text NOT NULL,
  media_part text NOT NULL,
  storage_key text NOT NULL,
  sha256 text NOT NULL,
  byte_size integer NOT NULL,
  content_type text NOT NULL,
  referenced boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, deck_id, media_part)
);
