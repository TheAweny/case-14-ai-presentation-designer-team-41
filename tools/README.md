# tools

Development utilities that are not part of the running service: test fixtures, evaluation runs and
the generator behind `docs/AUDIT.md`.

- Can import: `engine`, PyYAML, the standard library.
- Must not import: anything from `apps/` or `packages/`; it reads their files, it does not run them.
- Nothing here is shipped in the engine image.
