# registry

Agent definitions, one directory per agent: `agent.yaml` with id, semver version, model binding
and output schema, plus `instructions.md` with the system prompt. Prompts live here and never in
code, and each run records the versions it used.
