# @lct/engine-client

Typed HTTP client for the Python engine. Every response is validated with a schema from
`@lct/contracts` before it reaches the rest of the TypeScript side, so a contract drift fails
loudly at the boundary instead of leaking into the pipeline.

- Can import: `@lct/contracts`, Node built-ins, the global `fetch`.
- Must not import: `@lct/pipeline`, apps, `.pptx` libraries — document work belongs to the engine.
- Today it covers `GET /health`; parse, layout, export and render calls land here later.
