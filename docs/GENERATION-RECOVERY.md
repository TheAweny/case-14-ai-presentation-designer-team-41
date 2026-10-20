# Generation recovery: implementation and acceptance

Base: `cbb2e3ad39cf50a26f6f984cb76e07a8f388dc86` (security removal included).
Branch: `theaweny/generation-recovery-core`. Evidence recorded on 2026-10-19.
Production was not changed. This is a draft integration with remaining acceptance gaps below.

## Execution path and specification

At the base revision: chat tools / direct API → GenerationService → three Mastra workflows →
shared planner, separate writers → repairs → engine export/render/checks → final review →
filesystem artifacts + PostgreSQL events. SharedPlan reused planning; retry created another run
and did not restore accepted writer results. Mastra's fresh invocation did not supply the durable
task reuse required here.

The implementation keeps that workflow and adds the following boundaries:

1. Direct API, approved outline and chat enforce consistent slide counts: manual 5–15,
   automatic/outline 5–60. Explicit template selection wins; an accessible, unambiguous project
   template supplies the default. Ambiguity requires selection and account ACL remains enforced.
2. Immutable GenerationSpec fixes brief, template/profile, registry/schema, model policy, seed,
   date and pricing fingerprint. Stable build/variant identifiers survive retries. Validated
   TaskCheckpoints use dependency hashes and atomic fsync/rename; persistence failure fails the
   task rather than silently discarding its checkpoint.
3. A shared plan feeds three concurrent whole-deck writers by default, one per variant.
   Explicit `variantCopyMode=shared` retains one balanced writer for the entire deck. Composition remapping
   preserves ordered semantic groups and heading/body pairs; ambiguous legacy groups keep
   their original composition. Semantic reuse includes binding relationships and sources;
   every final file receives its own deterministic/render checks. A poor template reports
   limited diversity. The copy-policy change below supersedes earlier shared-copy evidence.
4. PostgreSQL claims a build with a 30-second lease, 10-second heartbeat and monotonic fence.
   Publication, final event and run state require current ownership. Concurrent start/resume
   observes the same identifiers; successful variants are retained. Stop persists a fence and
   terminal events for unfinished variants. Infrastructure interruption remains resumable.
5. A provider-independent journal reserves each physical HTTP attempt before dispatch and
   records outcome/usage before parsing. Compatibility sends, explicit probes, routed text,
   vision and images use the transport. Missing usage and missing price remain unknown.
6. Preparation reports index, geometry, fonts and capabilities separately. Ordinary model/UI
   reads do not probe models. Status distinguishes deadline, cancellation, interruption, provider
   errors, quota/budget, invalid response, export, persistence and quality failures. Usage cards
   expose cumulative known values and counts of unknown attempts.

Registry versions for this copy-policy change: deck-planner **2.10.0**, slide-writer **3.0.0**,
deck-critic **1.11.0**, slot-rewriter **1.9.0**. Chat instructions belong to executor 3;
this change does not update them. All actual versions are recorded in each manifest.
Manifest `planId` identifies the shared build. `modelCallsScope=build` prevents counting shared
successful calls three times. `providerUsage` is a journal snapshot at publication;
`GET /generation/:id/usage` reads the current cumulative journal, including failed attempts.

## Acceptance matrix

“Passed” identifies the evidence layer, not live-model or production acceptance.

| Requirement                                                                       | Evidence                                                                                                 | Status                                                            |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Exact 5/10/15 through direct API and approved workflow; chat count propagation    | contracts, actual offline Mastra workflow, controller/tool regressions; local HTTP 5 and restart HTTP 10 | Passed offline/runtime; chat browser conversation not replayed    |
| Explicit/project template precedence, ambiguity and ACL                           | chat context/tool and account-query counterexamples                                                      | Passed offline                                                    |
| Tool-only success, incomplete calls and interrupted stream                        | chat/compatibility regressions                                                                           | Passed offline                                                    |
| Resume after saved slide 7 without repeating accepted tasks                       | actual API container killed, lease expiry, two concurrent resumes, all three 10-slide variants done      | Passed runtime                                                    |
| Failed export with two successful variants retained                               | one injected engine 503, two concurrent resumes, zero new HTTP sends, unchanged completed timestamps     | Passed runtime                                                    |
| Duplicate start/concurrent claim, ownership, stale fence and publication rollback | PostgreSQL 17 and checkpoint/service regressions                                                         | Passed offline/DB/runtime                                         |
| Crash windows around accepted result, checkpoint and publication                  | atomic checkpoint failure, late response and DB rollback counterexamples; real process kill              | Specific windows passed; exhaustive fault matrix open             |
| Dependency drift and legacy fail-closed reuse                                     | immutable spec/checkpoint regressions                                                                    | Passed offline                                                    |
| Every HTTP send counted before dispatch, including invalid/truncated replies      | transport, compatibility and PostgreSQL ledger regressions                                               | Passed offline/DB                                                 |
| Cumulative request/token/cost budgets, unknown usage and atomic reserves          | concurrent PostgreSQL tests; tariff fingerprint tests                                                    | Passed offline/DB                                                 |
| Stop distinct from disconnect, restart and persistence interruption               | chat lifecycle, service, stream and PostgreSQL regressions                                               | Passed offline/DB; no complete browser Stop/disconnect matrix     |
| 429, Retry-After, fairness and bounded waiting                                    | fake clock/transport tests across build/chat owners                                                      | Passed offline for one process; distributed quota scope open      |
| Shared facts, native KPI/chart/table and three structural designs                 | workflow grounding tests, final PPTX import, cosmetic controls and contact sheet                         | Passed offline/runtime on synthetic fixture; live quality unknown |
| Readiness, partial/stale index, fonts and asset reuse                             | preparation/cache/font regressions; actual prepare endpoint                                              | Passed offline/runtime                                            |
| API + DB + engine + render/export                                                 | isolated containers; actual LibreOffice and PPTX round trips                                             | Passed runtime                                                    |
| Durable editor and exact exported revision                                        | Chromium edit → fresh browser context without IndexedDB → revision/hash export                           | Passed browser/runtime                                            |
| Bounded semantic batches versus one large response                                | no live comparison available                                                                             | Open; no batching performance claim                               |
| Live latency/tokens/cost/quality/SLA and measured stage/load budgets              | two Qwen HTTP 400 attempts; user then stopped all AI work                                                | Blocked by provider failures and explicit user instruction        |
| Production acceptance                                                             | no deployment authorized                                                                                 | Not performed                                                     |

## Independent integration review

PR 11 (`1ae239e1f3bb8d78d2bf95fa6b74cb35afdd652d`) was integrated first. Independent RED
counterexamples in `snapshot-store.integration.spec.ts` and `test_export_paint_order.py`
identified and verified repairs for:

1. Media aliases with identical bytes: deleting an orphan alias deleted another revision's file.
   Cleanup now checks every surviving reference under the upload/deck lock and keeps recent
   incomplete files.
2. Rejected conflicts losing their media: conflict media remain referenced.
3. Grouped text staying under an image: ancestor paint order is updated without ungrouping.
4. Missing upload references and duplicate media names: snapshot contracts reject both.
5. Invisible full-slide images incorrectly triggering the text occlusion check.

PR 12 (`e5a6f60710390b324c72540ec2bd9749b03e27e3`) was integrated second. Independent RED
counterexamples in `test_visual_integrator.py` and the composition endpoint verified repairs for:

1. Independent element permutations changing the structural digest. Tokens are canonicalized;
   overlapping content retains paint relationships, checked by a separate counterexample.
2. Missing XY values being skipped and joined over. Native charts retain x positions and gaps.
3. Dense tables measured with caption type but exported with body type. Measurement now uses
   the exported body size; untried smaller-type adaptations are not reported as fitting.
4. Native blocks disconnected from generation. A grounded `native` slot carries values through
   writer, composition export and final-file audit; overflowing content fails explicitly.
5. Final PPTX import rejecting XY charts or replacing missing category values with zero.
   Round-trip tests preserve positions, axis titles, gaps and measured zero separately.

Contact-sheet inspection found a further defect: text fit assumed word wrapping while composed
export retained the template's no-wrap flag, clipping a narrow title. An independent RED test
reproduced it. Replacement copy now wraps as measured, preserving box geometry and font size;
the already-wrapped positive case and actual rendered fixture were also checked.

The health adapter imports the generated health enum after schema generation changed enum names.
No generated Pydantic source was edited by hand. Engine layer boundaries remain enforced.

## Bugbot recovery follow-up

The three [Bugbot findings on PR 14](https://github.com/TheAweny/case-14-ai-presentation-designer-team-41/pull/14#pullrequestreview-5571447349)
were independently reproduced and repaired:

- Continue during an orphan's still-valid lease waits safely, then claims and executes after
  expiry instead of returning failed. Graceful shutdown releases its own leases as interrupted.
- Retry of a failed variant while siblings run queues that variant, preserving its stable id.
  Concurrent equivalent retries observe one executor; another failure does not loop indefinitely.
- Whole-build resume and variant retry seed SharedPlan with the validated saved plan, including
  the case where that plan exists but a planner task checkpoint does not.

Eleven PostgreSQL/GenerationService regressions cover these paths, renewal of a real live lease,
Stop during either wait, distinct-layout retries, bounded waiting and duplicate start at full local
capacity. These tests replace only `generatePresentation`; network/model calls are forbidden.
The capacity case additionally found and fixed duplicate start being rejected as new work;
a rejected third build no longer leaves durable orphan records.

The actual API kill harness now sends its first two Continue requests **4.071 seconds after the
kill**, before the old lease expires. All three ten-slide variants completed under the next fence,
with no repeated planner or accepted writer tasks. This uses the real engine/export/render with
the fake gateway. An initial run after starting the stopped stack reached the engine before it was
ready; the harness now checks both health endpoints before preparing the fixture. Waiting and
recovered execution share the same 290-second recovery request budget.

## Evidence and baseline comparison

Static: typecheck and lint passed for contracts, pipeline, API, web, engine and run-store.
Engine import boundaries: three contracts kept, zero broken. No dependency versions changed.

| Suite           | Passed | Environment                                                 |
| --------------- | -----: | ----------------------------------------------------------- |
| Contracts       |    331 | offline                                                     |
| Pipeline        |    542 | offline, actual Mastra workflow + fake provider             |
| API             |    528 | offline, editor and recovery PostgreSQL integration enabled |
| Web             |   1068 | offline                                                     |
| Run store       |     19 | actual PostgreSQL 17                                        |
| Engine/tools    |    546 | Linux, Python 3.12, actual LibreOffice                      |
| Editor recovery |      1 | Chromium, actual isolated web/API/DB/engine                 |

Windows-only shell/font limitations were superseded by the full Linux run. An Nx plugin loader
failed before one Linux invocation started; the standalone rerun passed. An API regression in
chat persistence handling was corrected: interruption aborts execution without persisting user
Stop, and explicit Stop retains its separate test. Totals above are after those repairs.

| Measurement                                          | Baseline                                        | New                                                                       | Interpretation                                                            |
| ---------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 10-slide, three-variant writer tasks                 | 30 writers + 1 planner                          | 10 writers + 1 planner                                                    | Same actual workflow, in-process fake provider                            |
| Same offline workflow duration                       | 62 ms                                           | 21 ms                                                                     | One sample; excludes inference/network/export/render; tokens/cost unknown |
| Local five-slide build before shared semantic review | 13 HTTP sends; 1,300/650 fixture tokens; 13.5 s | —                                                                         | Earlier implementation point, not the base revision                       |
| Local five-slide build with shared semantic review   | —                                               | 7 HTTP sends; 700/350 fixture tokens; 15.878 s                            | 1 planner + 5 writers + 1 critic; all three files/previews done           |
| Preparation for that last build                      | —                                               | 329 ms                                                                    | Separate from generation; fonts ready, 3 compositions/9 slots             |
| Export-only resume                                   | 2 variants done, 1 export failed                | 0 added HTTP sends, all 3 done                                            | Completed variants not republished                                        |
| Kill after 7 accepted writers                        | 7 accepted, remaining in flight                 | 0 accepted-task repeats; all 3 × 10 slides done                           | In-flight unknown outcomes may be sent again                              |
| Final fixture quality                                | No comparable base measurement                  | 0 deterministic errors, 3 warnings per variant; contextual status unknown | Sparse synthetic content; no visual quality acceptance                    |
| Final fixture diversity                              | No comparable base measurement                  | 3 structural signatures; cosmetic controls collapse                       | Actual final PPTX files, not just requested plans                         |
| Real Qwen inference/billing                          | No successful baseline                          | 2 HTTP 400, 0 accepted tasks; tokens/cost unknown                         | No latency, quality or SLA conclusion                                     |

The 7-send fake build is not faster than the earlier 13-send sample. These single local timings
measure different implementation points and cannot establish speedup or a five-minute SLA.
No p95, provider quota scope or success-rate estimate is inferred. The 290-second deadline and
export/render/persistence reserve remain; real stage budgets and supported maximum load need
measurements after AI work is explicitly reauthorized.

The two earlier Qwen trials used the saved Yandex configuration and then the documented
endpoint/model form. Both failed at planning with HTTP 400. The exact cause is unknown; the
provider's response body was not retained. The user subsequently instructed that no AI work
be done while Yandex may be unavailable. All live calls are stopped. The runtime harness now
rejects `RECOVERY_LIVE=1`; it does not switch models or keys. Unknown charge is not zero charge.

## Local evidence bundle

Artifacts stay under ignored `runs/recovery-runtime/`; they are not committed:

| File / identifier                                | Purpose                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `content-benchmark.json`                         | 30-to-10 workflow comparison with explicit measurement limits    |
| `runtime-result.json`                            | Last ordinary fake build: all three variants done                |
| `resume-trace.json`                              | Export failure/resume, global fake-send counter unchanged at 81  |
| `restart-trace.json`                             | Actual kill, Continue before lease expiry, zero accepted repeats |
| `restart-trace-pre-bugbot.json`                  | Earlier kill test that waited for lease expiry before Continue   |
| `artifact-evidence.json`, `contact-sheet.png`    | Final-file import, facts, signatures and actual previews         |
| `browser-editor.png`                             | Editor after server recovery in a fresh browser context          |
| `live-result.json`, `live-corrected-result.json` | Historical failed cloud trials; do not replay                    |

Last ordinary build: `406d6d09-d409-4cee-8e02-818a0c60ab32`; balanced run:
`run-dceca653-a9fb-462b-a53f-aa1664687d0c`.
Restart build: `a1c8dce5-2d20-4112-8c9c-807eacb44434`; balanced run:
`run-a9205f81-21dd-4841-924b-77706f9ba29d`.
Contact sheet uses the last ordinary build. Export-failure/resume balanced run:
`run-802d2932-e021-49c3-9154-28de2b56dd8f`.

Restart trace has new writer indices `[7,7,8,9]` (zero-based). Index 7 belonged to an in-flight
request when the process died and appears again after recovery. Indices 0–6 and the planner
were accepted and did not repeat. Pending/unknown reservations remain counted; this is not
provider-independent exactly-once billing.

Synthetic fixtures contain three compositions and known sample text. Their sparse appearance
is not a premium design benchmark. Contact-sheet inspection found layout differences but does
not replace visual quality acceptance. The last ordinary build verifies shared `planId`,
`modelCallsScope=build`, and `providerUsage` in its actual published manifests. Earlier historical
artifacts are not claimed to contain fields added afterward.

## Operator runbook

### Migration and immutable state

Apply migrations 022 and 023 through the existing run repository before serving the new API.
Back up PostgreSQL and the run directory together. Durable tasks live under `build-<uuid>/tasks`,
with stable variant ids and fence-specific execution directories. Never delete tasks to retry
an export. A publication manifest is installed last under ownership/fence protection.

`POST /generation/:id/resume` keeps the spec, accepted tasks and cumulative usage. Concurrent
calls return the same build. A new `requestId` explicitly regenerates. Stop persists its intent
and prevents automatic recovery; a later explicit resume can proceed. SSE disconnection only
detaches observation. Continue during an active lease observes it and reclaims after expiry if
needed; it never preempts a renewing owner. Graceful shutdown releases its own leases.

A changed registry, profile, schema, model/endpoint policy or tariff blocks reuse and requires a
new build. Legacy runs without a compatible spec fail closed. Keep their finished artifacts;
do not synthesize checkpoints from incomplete old records. Profile revision 5 adds measured font
readiness and invalidates older prepared profiles.

### Provider journal, tariffs and limits

Inspect `provider_attempts` and `GET /generation/:id/usage` for failed as well as successful work.
Compare logical task keys with physical attempt ids before diagnosing retries. Pending attempts
after process loss have unknown outcome; retain their reservations. Never treat missing usage
or absent tariffs as zero, and do not log credentials or full prompts.

`MODEL_PRICING_FILE` optionally names a JSON catalog with `version`, `source`, `effectiveAt` and
`models` keyed by exact model revision. Rows supply currency, inputPerMillion and outputPerMillion.
No guessed rates ship. Without a matching row, price is unknown. Monetary enforcement has been
removed by the current [enterprise access policy](AUTH-QUOTAS.md); legacy `budget.maxCost` and
`currency` are compatibility fields. Request/token caps work without tariffs.

Default build caps are 240 HTTP attempts and 2,000,000 reserved tokens. Interactive non-build
traffic uses an account-level allowance over the preceding hour of 10,000 attempts / 100,000,000 tokens.
These are operational ceilings, not measured provider limits or an authorized spending budget.
Pending/unknown outcomes remain reserved on resume.

`MODEL_MAX_CONCURRENCY`, `MODEL_RPM` and `MODEL_TPM` govern one process and endpoint. Retry-After
and bounded queue waiting do not bypass quota with another key/model. The provider's actual
scope remains unverified; multiple dispatchers must not assume this limiter is global.

### Reproducing offline evidence

Use Node 22.13+, yarn, uv and Docker with the repository's engine image containing LibreOffice.
All commands below are offline with respect to model providers. Set `NX_DAEMON=false`; if the
Windows plugin worker fails before execution, rerun with `NX_ISOLATE_PLUGINS=false`.

```powershell
$env:RUN_STORE_TEST_DATABASE_URL='postgresql://recovery:recovery-local@127.0.0.1:55419/recovery'
yarn nx run-many --targets=typecheck,lint --projects=contracts,pipeline,api,web,engine,run-store --parallel=3
yarn nx run-many --target=test --projects=contracts,pipeline,api,web,run-store --parallel=2
yarn nx run engine:test-linux
yarn nx run engine:boundaries
yarn nx run pipeline:recovery-benchmark
```

The checked stack used API :13019, PostgreSQL :55419, engine :18019 and fake gateway :19019;
fault API :13020 used engine proxy :18020. The user's original :3000/:3001 stack was untouched.
Configure the isolated API explicitly for the fake gateway before any runtime check.
`pipeline:recovery-runtime` uploads, prepares and builds through real HTTP. Fault mode uses
`RECOVERY_FAULTS=1` and `RECOVERY_API=http://127.0.0.1:13020`. The proxy injects one export failure.

`pipeline:recovery-restart` intentionally kills **only** `lct-recovery-api-faults` after seven
accepted writers and sends Continue before lease expiry. Run it only against that disposable stack,
after producing `faults-build.json`. `engine:recovery-evidence` inspects the resulting PPTX files
and previews. `web:e2e --grep="isolated API"` needs web :13119, `E2E_PORT=13119`, and
`RECOVERY_RUN_ID` pointing to a disposable completed balanced run; it edits that deck and checks
exact revision export. These scripts are fixture tools, not deployment setup.

### Rollback

Stop accepting new work and stop active workers. Keep the new tables, editor revisions and
filesystem tasks, then run the previous application version. Do not reverse migrations while
new builds/revisions exist. The previous version cannot resume the new builds; restoring this
version requires the same immutable dependencies. No main merge or deployment is included.

## Remaining work

Live five-minute acceptance, repeated latency/quality measurements, tariff-backed actual cost,
bounded-batch versus single-response comparison, measured stage/load budgets, provider quota
scope and distributed scheduling remain open. The recorded local results do not satisfy those
requirements. Exhaustive crash-window and browser Stop/disconnect coverage also remain partial.
AI-dependent measurements must wait for a new user instruction; no background model retry or
fallback is scheduled. These gaps keep the PR in draft.

## Copy-policy integration — 2026-10-19

New POST /generation requests default to variantCopyMode=independent. Set the JSON field
variantCopyMode to shared for the explicit economical fallback. Since 2026-10-20 the former mode creates
three whole-deck writer tasks; shared creates one balanced whole-deck task. Both reuse the same plan,
source evidence and compatible assets. Changing policy, source or registry requires a new
requestId/build; immutable retries cannot change them. Legacy specs missing the policy parse
as shared. Their old dependency hashes are never treated as new independent tasks.

Writer instructions consist of the common file, exactly one audience module selected using
both audience and goal, one density module and one output branch. The full module set is
included in the writer manifest hash; the selected instruction enters each task key. API's
registryHash includes the new files. No Mastra dependency, global thinking or sampling change
is part of this integration. Missing requiredClaims in a newly generated plan fails validation;
legacy saved plans remain readable. User-approved outline claims replace model-selected ones.

The critic receives actual final text, ordered groups, semantic roles, required claims and
sources. Its checkpoint canonicalization preserves pair relationships and includes the output
schema. Repairs retain three alternatives, select toward variant targets and run one semantic
attempt per invocation using the build attempt budget. HTTP retries still belong to the
provider and the same limiter/budget; 429 does not start a second repair loop.

Executor 2 integration: optional CompositionSlot.capacity={safeChars,basis} is generated into
Pydantic and accepted by TS. Geometry/text metrics reach writer. Python capacity calculation
has not been changed by this executor; absent metrics retain the legacy sample guard.
Executor 3 integration: audience/goal and confirmed facts use existing outline/brief fields.
This executor did not modify chat preparation. Integration contract and offline logs live in
spec/content-quality-2026-10-19/. No live model calls, runtime stack or production deployment
were performed for this change. Earlier runtime acceptance above describes earlier code.

## Whole-deck agents — 2026-10-20

The production runner uses `deck-writer` 1.0.0 and `deck-rewriter` 1.0.0. The shared planner
feeds three parallel requests, each containing all slides, source evidence and per-slide
template constraints. Strict schemas require every slide index and slot; accepted responses
are converted to slide IR without more writer calls. Existing slide-writer audience/density/output
modules remain part of the deck-writer manifest digest. The low-level workflow retains an
explicit compatibility path for callers without deck instructions; the production runner
always supplies them.

Repairs batch all affected slides of one variant and retain three alternatives per defective
slot. The bounded provider permits at most two batch repair rounds per variant. Transport
retries remain journalled physical sends, not additional logical agents. Whole-deck requests
keep their configured output ceiling across retries. The JSON parser rejects concatenated
answers instead of joining the first opening brace to the last closing brace.

Offline acceptance uses the actual Mastra workflow: 15 slides × 3 independent variants take
one planner and three concurrent writer requests. A failed airy writer resumes without
repeating the accepted planner, dense or balanced response. Three nonadjacent slides are
repaired in one request; a third semantic repair round is refused. These checks do not prove
the five-minute live-provider budget. Earlier per-slide timing and kill-test tables above
describe the historical implementation.

The local chat `bc8b3a6b-0320-4f14-af3b-45f91fa3f7a4` belongs to build
`c07ee9cf-a4a1-4526-adbf-5766207c5287`. Its initial attempt recorded 9 writer and 23 rewriter
activities; a resumed attempt recorded 13 writer, 17 rewriter and one cancelled critic.
The provider journal recorded 111 responses and one unknown outcome. Preparation had finished;
the build cards were failed, not stuck preparing. Failures included malformed concatenated
JSON and a template missing from the local containers' separate runs mount. The missing
template was restored from the primary checkout into that local mount. These are local
observations, not server measurements, and the failed attempts do not benchmark the new path.
