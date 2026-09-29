# api

NestJS service on Express. It owns accounts and sessions, stores templates and decks per account,
prepares templates (profile, composition index, slide previews), runs generation builds (three
variants in parallel), persists runs and artifact metadata in PostgreSQL, serves chat turns of the
assistant and model settings, and talks to the deterministic engine only through `@lct/engine-client`.
Mastra lives inside this process as a library, behind a provider — its own routes are never exposed.

Run lifecycle and artifact metadata are stored in PostgreSQL configured through `DATABASE_URL`.
Versioned SQL migrations run under a PostgreSQL advisory lock when the API starts. Generated files
stay in the mounted `runs/` directory; the database never stores PPTX or preview blobs. Model keys
from the settings are stored encrypted with AES-256-GCM (`MODEL_KEYS_SECRET`); no API response ever
contains a key. All routes except `GET /health` require `x-lct-service-token` with
`API_SERVICE_TOKEN` — the API answers only the web server, which proxies `/api/backend/...`.

With Docker Compose, PostgreSQL is available automatically. For a host-side API process, copy
`.env.example` to `.env`, start `postgres`, and export `DATABASE_URL` before running the API.

Main controllers: `files` (template upload), `generation` (prepare, build, artifacts, edited-deck
export), `chats` (assistant turns), `library` and `projects`, `models` (connections and role
choices), `accounts`/`auth` (users, sessions), `runs` (lifecycle events).

- Can import: `@lct/pipeline`, `@lct/registry`, `@lct/engine-client`, `@lct/contracts`, `@lct/run-store`.
- Must not import: `apps/web`, `.pptx` libraries — document work belongs to the Python engine.
- Talks to the engine only through `@lct/engine-client`.
