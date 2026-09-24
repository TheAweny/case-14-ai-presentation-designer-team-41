# MVP requirements and local run protocol

## Product boundary

The repository is an open-source, local-first generator. It accepts a PPTX template and a content
pack, creates three distinct editable PPTX variants, and writes a deterministic audit report and
manifest. Authentication, user accounts, databases, cloud storage and distributed workers are out
of scope.

## Local protocol

1. A caller supplies `templatePath`, `contentPath`, slide count, seed and output directory in a
   run configuration.
2. The API or CLI validates the inputs and assigns a stable local run id.
3. The Python engine receives typed contracts and returns template profile, slide IR, audit data
   and exported artifacts. It never calls a model.
4. The TypeScript pipeline creates the plan once, reuses it for all three strategies, and writes a
   manifest under `runs/<run-id>/`.
5. Every artifact is linked by stable ids and SHA-256 digests. A completed run is inspectable from
   its local directory.

## Contract traceability

| Requirement                             | Contract           | Verification                  | Evidence                 |
| --------------------------------------- | ------------------ | ----------------------------- | ------------------------ |
| Template adapts without file-name rules | `TemplateProfile`  | valid/invalid schema fixtures | profile JSON in manifest |
| One grounded narrative is reused        | `DeckPlan`         | source-reference schema tests | plan JSON in manifest    |
| Slides remain locatable and editable    | `SlideIR`          | bbox validation tests         | engine export artifact   |
| Defects are explainable                 | `AuditFinding`     | finding fixture tests         | audit JSON               |
| Run is reproducible                     | `ArtifactManifest` | exactly-three-variants test   | manifest JSON            |
| Progress is factual                     | `RunEvent`         | event schema test             | local run log            |
