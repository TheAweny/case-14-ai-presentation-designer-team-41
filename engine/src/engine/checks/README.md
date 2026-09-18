# engine.checks

The deterministic half of the audit: geometry, contrast, counts, font usage, leftover placeholder
text. Each check is declared in `registry.py`, which is also what `docs/AUDIT.md` is generated
from.

- Can import: `engine.contracts`, the standard library.
- Must not import: any other engine layer, any model client.
- Every new check ships with two tests: a slide that violates it and a slide that satisfies it.
