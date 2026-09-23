# api

NestJS service on Express. It creates and reads filesystem-backed local runs, exposes API and
engine health, and will connect the local run lifecycle to the pipeline in later tasks. Mastra
lives inside this process as a library, behind a provider — its own routes are never exposed.

Runs are stored below `RUNS_DIR` or `./runs` by default. No database, accounts, uploads or cloud
storage are part of the local MVP.

- Can import: `@lct/pipeline`, `@lct/registry`, `@lct/engine-client`, `@lct/contracts`, `@lct/run-store`.
- Must not import: `apps/web`, `.pptx` libraries — document work belongs to the Python engine.
- Talks to the engine only through `@lct/engine-client`.
