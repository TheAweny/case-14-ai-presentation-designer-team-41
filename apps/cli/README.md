# cli

Initialises a local generation run from a validated config, with no web UI involved. It is the
reproducible entry point used by `eval/` scenarios and CI.

```bash
yarn nx run cli:run-config
```

The command creates `runs/<run-id>/` with `inputs`, `profile`, `plan`, `variants`, `audit`,
`previews` and `run.json`. The later pipeline stages populate those directories.

- Can import: `@lct/contracts`, `@lct/registry`, `@lct/run-store`, `@lct/pipeline`, Node built-ins.
- Must not import: `apps/web`, `apps/api`, `.pptx` libraries.
