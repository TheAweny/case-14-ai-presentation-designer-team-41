# engine.layout

Turns a deck plan plus a template profile into the slide IR. Fully deterministic: same inputs,
same output, no randomness and no model calls.

- Can import: `engine.contracts`, the standard library.
- Must not import: any other engine layer, any model client.
- On overflow it emits a signal instead of shortening text; rewriting is the agent's job.
