-- Chats with the assistant: a request, the agent's answers, the builds and their results. The web
-- keeps the whole conversation as one document and saves it as it changes; the API stores it for
-- the owner and never reads the messages. The decks a chat produced are listed so a deck can lead
-- back to its chat.
CREATE TABLE IF NOT EXISTS chats (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  title text NOT NULL,
  project_id text REFERENCES library_projects(id) ON DELETE CASCADE,
  template_id text,
  deck_ids text[] NOT NULL DEFAULT '{}',
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  conversation jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chats_owner_updated_idx ON chats(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS chats_deck_ids_idx ON chats USING gin (deck_ids);
