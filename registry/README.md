# registry

Agent definitions, one directory per agent: `agent.yaml` with id, semver version, model binding
and output schema, plus `instructions.md` with the system prompt. Prompts live here and never in
code, and each run records the versions it used.

`shared/` holds prompts every generation agent uses, outside any one agent: the answer format that
carries the JSON Schema of an answer, and the request to repair an answer that misses it.
`shared/shared.yaml` names the files and their version.
