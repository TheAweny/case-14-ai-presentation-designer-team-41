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

- Can import: `engine.contracts`, the standard library, python-pptx and Pillow for file checks.
- Must not import: any other engine layer, any model client.
- Every new check ships with two tests: a slide that violates it and a slide that satisfies it
  (`engine/tests/test_audit_checks.py` enforces it for every registered id).

## Exported image/text audit

`image_readability.py` reads the saved PPTX independently of other engine layers. Its definition
is in `registry.PPTX_CHECKS`, separate from the legacy SlideIR rules. Run
`audit_exported_deck(pptx_path, request, profile_name, profile,
editable_text_shape_ids=...)` to include its findings in report counts, categories, score and
`passed`. The equivalent internal API keys for `audit_deck` are `pptxPath` and
`editableTextShapeIds`. These keys are not wire-contract fields. The request represents one
variant, with slides in file order. Shape selectors contain decimal OOXML `cNvPr/@id` strings,
one list per exported slide; an absent selector means all slide text, an empty list means none.
Unknown selector ids raise instead of silently skipping the audit.

`audit_image_readability(pptx_path, *, variant="balanced", slide_ids=None,
editable_text_shape_ids=None, profile=None)` also returns standalone AuditFinding dictionaries.
Targets use `slide-<shape_id>`, including parent ids for grouped shapes. This is a file target,
not an inferred composition slot id. No generated contract changes are needed.

The check measures the whole inset text frame, splitting it at background boundaries. It uses
actual local media pixels with crop and z-order, not a rendered screenshot containing glyphs.
The minimum contrast is conservatively bounded across the observed luminance interval; the
maximum luminance range catches heterogeneous backgrounds. Defaults are 4.5 and 0.35, configurable
under `image-text-readability`. Existing opaque rectangular sRGB protection can cover an unsafe
picture. Partial protection leaves exposed regions subject to the check. No repair is applied;
findings recommend a compatible composition or existing permitted protection and another audit.

Only positive crops, opaque PNG/JPEG/BMP, explicit sRGB colours and axis-aligned rectangular
shapes are measured. Axis-aligned group translation/scaling is supported. Rotation, flips, group
effects, theme colours/effects, opacity, nonrectangular geometry, unresolved inheritance,
foreground occlusion, dynamic fields and growing `spAutoFit` text frames produce **major unknown**
findings with a concrete reason in `evidence.measured`, never a successful measurement. A plain
`noFill` textbox needs no geometry. Opaque protection can make unsupported media below irrelevant.
The image budget is 16 million decoded pixels per slide, media sampling is at most one million
pixels per text frame, and the overlap partition is at most 256 cells. Exceeding a budget is unknown.
The frame approximation can overreport and is not a glyph layout/recognition engine.

Synthetic positive, negative and render checks live in `engine/tests/test_image_readability.py`.
The render check uses LibreOffice and pdftoppm and skips when those executables are unavailable.
