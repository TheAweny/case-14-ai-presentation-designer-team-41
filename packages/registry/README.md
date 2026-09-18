# @lct/registry

Reads agent definitions from `registry/agents/<agent-id>/` — `agent.yaml` plus `instructions.md` —
validates them against the schema from `@lct/contracts` and records the run manifest
(agent and prompt versions, model revisions, seed).

- Can import: `@lct/contracts`, `yaml`, `zod`, Node built-ins.
- Must not import: `@lct/pipeline`, apps, anything that talks to a model.
- Prompts stay in files: this package never inlines instruction text.
