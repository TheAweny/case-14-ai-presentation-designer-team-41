-- The agent answers chats on the server now: the API writes their messages, and the documents the
-- web used to save do not fit them. Those chats are removed; their decks stay in the library.
-- A chat remembers the mode of its last turn and the deck it leads to.
DELETE FROM chats;

ALTER TABLE chats DROP COLUMN IF EXISTS conversation;
ALTER TABLE chats DROP COLUMN IF EXISTS template_id;
ALTER TABLE chats
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'plan' CHECK (mode IN ('chat', 'plan', 'auto'));
ALTER TABLE chats ADD COLUMN IF NOT EXISTS primary_deck_id text;
