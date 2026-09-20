# Contract fixtures

One file per contract, named after it. Each file holds the cases that define what the contract
accepts and what it refuses:

```json
{
  "contract": "DeckPlan",
  "valid": [{ "name": "...", "payload": {} }],
  "invalid": [{ "name": "...", "why": "...", "path": ["slides", 0], "payload": {} }]
}
```

`path` is where the failure is expected. The suites assert that an invalid case fails **there**,
because a fixture that fails for an unintended reason proves nothing about the rule it was
written for.

Both sides read these files. The TypeScript suite validates them against the Zod schemas, the
Python suite against the generated Pydantic models, so a disagreement between the two shows up as
a failing test rather than as a bug in a run.

## Golden fixtures

`golden/` holds real parser output for the generated test decks, committed as JSON. It is written
by `uv run write-golden-ir` and checked by both suites. Two things break it on purpose: a change
in what the parser emits, and a change in the contract that no longer accepts what it emits.

## How an incompatible change breaks CI

Nothing here is versioned by hand. The valid and golden cases are recorded against
`schemaVersion: 1`, so removing a field, tightening a rule or bumping the version stops them
parsing and the suites go red. Making that pass again means adding the cases for the new version,
which is the point: the break is a prompt to write the migration down.
