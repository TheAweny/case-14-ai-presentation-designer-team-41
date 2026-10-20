Save preparation as a patch: `{"entries":[{"key":"...","value":null,"status":"unknown"}]}`.
Keys are `audience`, `goal`, `desiredAction`, `requirements.*` or `questionPolicy`. Keep audience,
goal and desiredAction in separate entries. Each value is a string or null; each status is one of
`user`, `source`, `assumption`, `unknown`, `declined`.

For user/source, supply `evidence: {messageId, quote, callId?, sourceId?}` with identifiers from the
actual corresponding message/tool result. `quote` must be exact and verified against that user
message or a successful source tool, and support the saved value. `facts.evidenceMessages` lists the
last 40 message IDs with roles and user previews (200 characters) or successful tool callIds.
For a source tool in this turn, use `facts.currentAssistantMessageId` as messageId and the model's
tool call ID as callId; for earlier sources, use evidenceMessages. Never invent IDs or infer unread
text from a preview. For source evidence, identify the successful call and source as applicable;
do not treat a search snippet, inaccessible source,
template sample or another agent's inference as proof. Source evidence remains attributed to the
source, not promoted to user confirmation. Do not invent evidence or save a guess as user/source.

Mark inference explicitly as `assumption`; `unknown` and `declined` require null values. When the
person requests no questions, save `questionPolicy` with value `no-questions`, status user and the
exact request as evidence. Preserve a missing fact as unknown or a refusal as declined.

The server merges the latest entry by key and returns `{entries, revision}`; revision is a hash.
Use that returned state on subsequent turns. Patch only changed entries, preserving other confirmed
facts. A user correction can replace an entry; do not restart preparation or repeat `ask_user` for
user/source/unknown/declined keys. Saving preparation does not approve a plan, start a build or
grant access to sources. If saving fails, do not claim the context was saved.
