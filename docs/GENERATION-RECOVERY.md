# Generation recovery: implementation and acceptance

Base: `cbb2e3ad39cf50a26f6f984cb76e07a8f388dc86` (security removal included).
Branch: `theaweny/generation-recovery-core`.

## Existing path

Chat tools / direct generation API → GenerationService → three generatePresentation calls →
Mastra plan + foreach writer → bounded repairs → engine checks/export/render → final review →
filesystem artifacts + PostgreSQL run events. SharedPlan currently shares only planning;
SharedIllustrations shares in-memory images. Mastra starts a fresh run on every invocation;
retryVariant creates a new product run. This does not resume accepted writer results.

## Scope and sequence

1. RED regressions and input consistency (5/10/15), project template context and ACL.
2. Validated durable task checkpoints, shared canonical content and dependency fingerprints.
3. Immutable build spec, idempotent starts/resumes, ownership and fencing.
4. Provider attempts, cumulative budgets, unknown usage and quota scheduling.
5. Template readiness, distinct design plans and actionable Russian status.
6. Offline, local runtime and browser acceptance; integrate available Cursor PRs sequentially.

Cursor A owns editor persistence/revision/media and general export overlap fixes.
Cursor B owns native infographic modules and visual diversity evidence. This branch does not
rewrite either implementation before its review. One bounded Qwen live build was subsequently
authorized by the user. Production modifications are not authorized.

## Acceptance matrix

Evidence statuses below are intentionally pending until checks execute.

| Requirement                                                | Evidence                            | Status          |
| ---------------------------------------------------------- | ----------------------------------- | --------------- |
| 5/10/15 through direct API, outline, chat                  | contracts/workflow/API regressions  | pending         |
| Explicit/project template precedence and ACL               | tool context regressions            | pending         |
| Resume after slide 7, no accepted task repeats             | real workflow + fake provider       | pending         |
| Failed export, two successful variants preserved           | runner/service regression           | pending         |
| Duplicate start/concurrent resume, stale worker, ownership | PostgreSQL + offline checks         | pending         |
| Dependency drift and legacy safety                         | checkpoint regressions              | pending         |
| Every HTTP send counted before dispatch                    | compatibility/transport regressions | pending         |
| Invalid/truncated/unknown outcomes counted                 | ledger regressions                  | pending         |
| Cumulative budgets and atomic reservations                 | concurrent budget regressions       | pending         |
| Stop distinct from disconnect/restart/deadline             | API/chat/browser checks             | pending         |
| Quota/backoff/fairness across builds/chat                  | fake clock transport tests          | pending         |
| Shared facts and three composition plans                   | workflow/source coverage tests      | pending         |
| Template readiness, partial/stale index                    | preparation tests                   | pending         |
| Local API + PostgreSQL + engine/render/export              | isolated local run                  | pending         |
| Live SLA, latency/tokens/cost/quality/diversity            | approved paid benchmark             | budget required |

Offline evidence so far: actual Mastra workflows verify 5/10/15, one canonical writer per
slide across three variants, and replay after failure at slide 8. PostgreSQL 17 in an isolated
local container verifies duplicate creation, concurrent claims, ownership, fencing, explicit
Stop, publication rollback and atomic cumulative usage reservations (19 tests including existing
run repository checks). This is runtime database evidence, not a live model SLA measurement.

The user authorized a limited Qwen 3.6 35B live check. The configured endpoint is Yandex Cloud;
the live check is limited to one five-slide build and a hard HTTP-attempt ceiling, with image
generation disabled. No monetary rate is inferred from a model name.

## Measurement rules

Preparation and generation are separate. Generation keeps the existing 290 second deadline
and export/render/persistence reserve. No unmeasured p95, cost, quota scope or success rate is
claimed. Missing usage or price is unknown. A lost provider response may incur an unknown
charge; provider-independent exactly-once billing is not promised.

## Integrated PR review: reproducible findings

PR 11 (`1ae239e1f3bb8d78d2bf95fa6b74cb35afdd652d`) was integrated first. Independent
counterexamples in `snapshot-store.integration.spec.ts` and `test_export_paint_order.py`
initially failed, then passed after these repairs:

1. Two media names with identical bytes shared one file. Removing an orphan name deleted
   the published revision's bytes. Cleanup now checks every surviving reference under the
   same deck lock used by uploads and keeps recent incomplete files.
2. A rejected conflict's media were treated as orphan uploads. Conflict media remain referenced.
3. Reordering text inside a group did not reorder the group's ancestor above a slide picture.
   Export now reorders ancestors while preserving group membership.
4. Snapshot contracts now reject missing upload references and duplicate media names.
5. An invisible full-slide image no longer triggers the text occlusion check.

PR 12 (`e5a6f60710390b324c72540ec2bd9749b03e27e3`) was integrated second. Independent
`test_visual_integrator.py` counterexamples failed before repair:

1. Permuting independent elements changed the structural digest without changing the design.
   Signature tokens are canonicalized.
2. An XY chart omitted a missing measurement and connected its neighbours. Its x position and
   empty y value now remain in the native chart and worksheet.
3. Dense tables were measured with caption typography but exported with body typography.
   Measurement now uses the same body step as export.
4. Untried smaller-type adaptations were reported as fitting. Only the measured arrangement
   is reported. Overflow fails explicitly, preserving the supplied data.
5. The endpoint was disconnected from generation. A `native` slot adapter now carries grounded
   KPI/chart/table inputs through the writer, composition export and final-file audit. The
   independent KPI test exercises all three variants through that composition API.

Generated Pydantic enum names changed when the visual schemas were added. The health adapter
was updated to import the generated health status enum rather than the source-evidence status.

## Evidence recorded during integration

- PostgreSQL 17: 19 run-store tests, including atomic budget reservations, fencing, concurrent
  claim, Stop, unknown outcomes and publication rollback. Editor tests use the same real DB.
- Engine in Linux with LibreOffice: 539 tests passed, including actual rendering, native
  PowerPoint data, fonts and layer boundaries. Windows skips do not stand in for this result.
- API at the editor integration point: 511 tests passed. Pipeline after semantic sharing:
  537 tests passed. Final counts are recorded after the final validation run.
- Isolated API :13019, DB :55419, engine :18019: one fake build completed all three five-slide
  files and previews in 13.5 seconds observed by the harness. It used 13 synthetic HTTP sends
  (1,300/650 fixture tokens); these are synthetic usage, not a model latency or billing result.
- Chromium against web :13119: a real edit survived a fresh browser context with no IndexedDB;
  export returned the exact acknowledged revision and content hash. Screenshot and trace are
  under `runs/recovery-runtime`, excluded from Git.

The fake template is synthetic and unfamiliar; its first version deliberately had small text
capacities. Its sparse appearance is not a quality benchmark. The current fixture also exposes
room for native blocks. Template indexing and preview preparation are measured separately.

## Operator notes

Apply migrations 022 and 023 through the existing run repository before serving the new API.
Back up PostgreSQL and the run directory together. Durable tasks live under `build-<uuid>/tasks`,
with stable variant ids and fence-specific execution directories. Do not delete those tasks to
retry an export. `POST /generation/:id/resume` retains the spec, accepted tasks and usage; a new
request id explicitly regenerates. A changed registry, profile, endpoint/model policy or tariff
file blocks reuse and requires a new build. Legacy runs without a compatible spec fail closed.

`MODEL_PRICING_FILE` optionally names a JSON catalog with `version`, `source`, `effectiveAt` and
`models` keyed by exact model revision. Each row supplies currency, inputPerMillion and
outputPerMillion. No rates ship guessed. Without a matching row, price is unknown. An explicit
request `budget.maxCost` also requires `currency`; unknown prices cannot pass that cap. Request
and token caps still work without a tariff. Resume retains pending and unknown reservations.

`MODEL_MAX_CONCURRENCY`, `MODEL_RPM`, and `MODEL_TPM` are operator inputs for one process and
endpoint. They are not evidence of a provider's actual quota scope. Distributed quota coordination
is not yet established; do not deploy multiple dispatchers and assume the process limiter is global.
Interactive non-build usage currently shares an account-level cumulative allowance; build budgets
are separate and durable. This operational limitation remains explicit.

Rollback: stop accepting new work, stop active workers, keep the new tables and filesystem tasks,
and run the previous application version. Do not reverse the migration while new builds or editor
revisions exist. The previous version cannot resume these new builds; restoring the new version
requires the same immutable dependencies. No main merge or deployment is part of this work.
