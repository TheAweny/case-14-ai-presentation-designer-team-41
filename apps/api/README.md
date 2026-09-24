# api

NestJS service on Express. It creates and reads PostgreSQL-backed runs, exposes API, database and
engine health, and will connect the run lifecycle to the pipeline in later tasks. Mastra lives
inside this process as a library, behind a provider — its own routes are never exposed.

Run lifecycle and artifact metadata are stored in PostgreSQL configured through `DATABASE_URL`.
Versioned SQL migrations run under a PostgreSQL advisory lock when the API starts. Generated files
stay in the mounted `runs/` directory; the database never stores PPTX or preview blobs. Accounts,
authentication and cloud storage are not part of the local MVP.

With Docker Compose, PostgreSQL is available automatically. For a host-side API process, copy
`.env.example` to `.env`, start `postgres`, and export `DATABASE_URL` before running the API.

- Can import: `@lct/pipeline`, `@lct/registry`, `@lct/engine-client`, `@lct/contracts`, `@lct/run-store`.
- Must not import: `apps/web`, `.pptx` libraries — document work belongs to the Python engine.
- Talks to the engine only through `@lct/engine-client`.
