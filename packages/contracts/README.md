# @lct/contracts

Source of truth for every schema shared between the TypeScript side and the Python engine:
run configuration, agent configuration and, later, template profile, deck plan and slide IR.

- Can import: `zod` only.
- Must not import: any other workspace package, anything Node- or browser-specific.
- `nx run contracts:schema` writes JSON Schema to `schema/`; `nx run contracts:codegen` turns the
  bundle into Pydantic models in `engine/src/engine/contracts/_generated.py`. Both outputs are
  committed, and CI fails if re-running the chain changes them.
