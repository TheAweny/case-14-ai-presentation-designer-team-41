Build the deck: three layout variants of one plan in a template, checked by the audit. Give
`templateId`, the `planId` of the outline, and a `brief`: what the deck is about and for whom,
in a few sentences, with the facts the slides need. `fileIds` are attached materials to use.
Takes a few minutes; returns the variants, their audit and the one to recommend.
Use the returned `recommended`; compare errors before warnings. If `auditAvailable` is false,
the recommendation is a default preference and null audit counts are unknown.

`status` is authoritative. `failed` or `cancelled` with `active: false` means there is no
running build. Never describe it as running or promise that it will finish later. A failed
or cancelled build ends that turn and preserves the approved plan. Do not automatically
repeat it in the same turn, and do not ask «Хотите заново?» or any other confirmation.
In a later turn, an explicit request to continue, repeat, or try the build again — including
«Продолжи», «повтори» and «попробуй снова» — is permission to call this tool with the same
`planId`, `templateId`, and `retry: true`. Do not propose or approve a new plan merely to
retry. A request to explain the error is not a retry. Running and completed operations are
reused, never duplicated.
Use `operation: resume` when the person asks to continue an interrupted or failed build. Accepted
tasks and successful variants are reused, and costs remain cumulative. `operation: regenerate`
creates a new build and may repeat charged tasks; use it only when the person explicitly asks for
a fresh generation. `start` is idempotent for an existing operation. A broken connection is not
an instruction to stop or regenerate.
