# cli

Runs a deck generation from a config file, with no web UI involved — the reproducible entry point
used by `eval/` scenarios and by CI.

- Can import: `@lct/contracts`, `@lct/registry`, `@lct/pipeline`, Node built-ins.
- Must not import: `apps/web`, `apps/api`, `.pptx` libraries.
- Today it validates `configs/run.example.yaml` against the contract and prints the parsed config.
