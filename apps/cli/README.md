# cli

Initialises a generation run in PostgreSQL from a validated config, with no web UI involved. It is
the reproducible entry point used by `eval/` scenarios and CI.

```bash
yarn nx run cli:run-config
```

The command requires `DATABASE_URL`, applies pending versioned migrations and creates a queued run.
Later pipeline stages place binary inputs and outputs under `runs/<run-id>/` and register their
metadata in PostgreSQL; files themselves are not stored in the database.

To inspect persisted progress events from the terminal:

```bash
node apps/cli/dist/main.js events <run-id> [after-sequence]
```

- Can import: `@lct/contracts`, `@lct/registry`, `@lct/run-store`, `@lct/pipeline`, Node built-ins.
- Must not import: `apps/web`, `apps/api`, `.pptx` libraries.
