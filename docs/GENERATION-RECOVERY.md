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
rewrite either implementation. No paid model calls or production modifications are authorized.

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
