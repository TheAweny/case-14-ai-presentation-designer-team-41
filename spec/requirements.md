# MVP requirements and local run protocol

## Product boundary

The repository is an open-source, local-first generator. It accepts a user-provided PPTX template
and a content pack; the extended input adapters may also ingest PDF and HTML source documents as
content. It analyses the template in a separate preparation stage, then creates three distinct
editable variants within five minutes of the user's generation request. A local user run may set
`variantCount` from 1 to 3; the organizer evidence gate always runs with all three variants. Each run writes
PPTX, PDF and HTML artifacts, deterministic and contextual audit findings, selected fixes, and a
manifest. Authentication, user accounts, cloud storage and distributed workers are out of scope.
PostgreSQL is permitted only as the local run metadata store; it never stores input or output blobs.

## Local protocol

1. A caller supplies a PPTX template, one or more content inputs (`.pdf`, `.html` or supported
   text formats), `variantCount` (1–3), slide count, seed and output directory in a run
   configuration. PDF/HTML inputs are normalized into the same grounded content-pack contract;
   they are not treated as presentation templates.
2. The API or CLI validates the inputs and assigns a stable local run id.
3. The Python engine receives typed contracts and returns template profile, slide IR,
   deterministic audit data and exported artifacts. It never calls a model.
4. The TypeScript pipeline creates the plan once, uses models only on the TypeScript side,
   reuses the plan for the requested 1–3 strategies, executes contextual audit and applies only
   the findings selected by the user.
5. The timed generation interval starts when the user submits the generation request and ends when
   all requested variants and their required artifacts are ready; the organizer evidence run uses
   all three and must not exceed five minutes.
6. Every artifact is linked by stable ids and SHA-256 digests. A completed run is inspectable from
   its local directory.

## Contract traceability

| Requirement                             | Contract           | Verification                  | Evidence                  |
| --------------------------------------- | ------------------ | ----------------------------- | ------------------------- |
| Template adapts without file-name rules | `TemplateProfile`  | valid/invalid schema fixtures | profile JSON in manifest  |
| One grounded narrative is reused        | `DeckPlan`         | source-reference schema tests | plan JSON in manifest     |
| Slides remain locatable and editable    | `SlideIR`          | bbox validation tests         | engine export artifact    |
| Three variants complete in <= 5 minutes | `RunEvent`         | timed E2E test                | timing in manifest        |
| User can request 1–3 variants           | `RunConfig`        | variant-count contract test   | variant count in manifest |
| PDF/HTML/PPTX content inputs normalize  | `ContentPack`      | adapter fixture tests         | input hashes in manifest  |
| Defects are explainable and actionable  | `AuditFinding`     | passing/failing check tests   | audit JSON                |
| Selected fixes preserve other findings  | `FixPatch`         | selected-fix E2E test         | re-audit and manifest     |
| Run is reproducible                     | `ArtifactManifest` | exactly-three-variants test   | manifest JSON             |
| Progress is factual                     | `RunEvent`         | event schema test             | local run log             |
