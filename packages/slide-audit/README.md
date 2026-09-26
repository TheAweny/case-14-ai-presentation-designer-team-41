# @lct/slide-audit

Deterministic checks over `SlideIR`: text past its box, overlapping content, content off the slide
or past the template margins, filler text and empty boxes, text contrast, missing typefaces.

- Can import: `@lct/contracts`, `@lct/slide-renderer` (for how a slide is painted: colours, type
  roles, decoration fills), so the audit judges exactly what the renderer draws.
- Must not import: apps, `.pptx` libraries, or anything that calls a model.

The same checks run in the editor after every edit and can run in the pipeline after layout.
What only a browser can measure comes in through `AuditContext`: the height text takes when set in
the loaded fonts, and which typefaces are missing. Without them the audit falls back on the
overflow the layout recorded and assumes every typeface is present.

Two levels: an `error` breaks the slide as shown or exported, a `warning` is worth a look.
`toAuditFinding` writes an issue as the `AuditFinding` contract for the run report. Every check has
a slide that violates it and one that passes in `src/audit.spec.ts`.

Thresholds are the `default` profile of `configs/audit.yaml`, kept in `src/default-profile.json`
because the filler strings the audit looks for must not appear in source; a test keeps the two in
step.
