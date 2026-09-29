# @lct/contracts

Source of truth for every schema shared between the TypeScript side and the Python engine:
run configuration, agent configuration, template profile, composition plans, SlideIR, chat turns,
audit reports and the model catalogue.

- Can import: `zod` only.
- Must not import: any other workspace package, anything Node- or browser-specific.
- `nx run contracts:schema` writes JSON Schema to `schema/`; `nx run contracts:codegen` turns the
  bundle into Pydantic models in `engine/src/engine/contracts/_generated.py`. Both outputs are
  committed, and CI fails if re-running the chain changes them.
