# engine.contracts

Pydantic models shared with the TypeScript side. `_generated.py` is produced by
`yarn codegen` from the Zod schemas in `packages/contracts` and is committed as is.

- Can import: pydantic and the standard library.
- Must not import: any other engine layer. This is the only module every layer may depend on.
- `provisional.py` holds aliases for contracts whose Zod schema has not landed yet.
