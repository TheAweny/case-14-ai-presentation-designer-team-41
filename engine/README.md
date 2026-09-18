# engine

The Python side of the product: everything deterministic that touches a document. It parses an
uploaded .pptx into a template profile, lays out the deck, draws native charts and tables,
exports .pptx and .pdf, renders PNG previews and runs the deterministic audit checks.

- Can import: pydantic, FastAPI, python-pptx, Pillow, the standard library.
- Must not import: any model client. Every model call in this repository lives in TypeScript.
- Layers (`parser`, `layout`, `visuals`, `export`, `render`, `checks`) never import each other;
  `engine.api` is what connects them. The rule is enforced by import-linter.
