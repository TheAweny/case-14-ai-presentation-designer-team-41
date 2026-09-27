# engine.checks

The deterministic half of the audit and the verification step for any slide generator: geometry,
template fidelity, density, leftover placeholder text. Each check is declared in `registry.py`,
which is also what `docs/AUDIT.md` is generated from; thresholds default to the case requirements
and are overridden per profile in `configs/audit.yaml`.

Input is an `AuditRequest` (SlideIR of the deck, the DesignSystem and PatternCatalog of the
template), output an `AuditReport`: `passed`, a score for ranking variants, a summary per
requirement group and findings with evidence and, where the fix can be computed, a `FixPatch`.

- HTTP: `POST /v1/audit` on the engine.
- Command line: `uv run deck-audit request.json` prints the report; exit 0 passes, 1 does not,
  2 means the request itself is invalid.

- Can import: `engine.contracts`, the standard library.
- Must not import: any other engine layer, any model client.
- Every new check ships with two tests: a slide that violates it and a slide that satisfies it
  (`engine/tests/test_audit_checks.py` enforces it for every registered id).
