Build the deck: three layout variants of one plan in a template, checked by the audit. Give
`templateId`, the `planId` of the outline, and a `brief`: what the deck is about and for whom,
in a few sentences, with the facts the slides need. `fileIds` are attached materials to use.
Takes a few minutes; returns the variants, their audit and the one to recommend.
Use the returned `recommended`; compare errors before warnings. If `auditAvailable` is false,
the recommendation is a default preference and null audit counts are unknown.
