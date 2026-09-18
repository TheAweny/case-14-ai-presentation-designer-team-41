# api

NestJS service on Express: creates runs, streams progress over SSE, accepts template and content
uploads. Mastra lives inside this process as a library, behind a provider — its own routes are
never exposed.

- Can import: `@lct/pipeline`, `@lct/registry`, `@lct/engine-client`, `@lct/contracts`.
- Must not import: `apps/web`, `.pptx` libraries — document work belongs to the Python engine.
- Talks to the engine only through `@lct/engine-client`.
