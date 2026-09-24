# engine.api

FastAPI application that exposes the engine to the TypeScript side and wires the independent
layers together.

- Can import: every engine layer, FastAPI, the standard library.
- Must not import: any model client — the engine has no model calls at all.
- The service is reachable only from the API container; it is never published to the internet.

`POST /v1/editable-decks` is the local MVP vertical slice. It receives template/output paths and
fixture slide content through the generated `EditableDeckRequest` contract, then returns the
validated `EditableDeckResponse`. This is the only place that joins parser, layout and export.
