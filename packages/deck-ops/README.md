# @lct/deck-ops

Editor changes over a deck of `SlideIR`, without React.

- Can import: `immer`, `@lct/contracts`.
- Must not import: React, apps, `.pptx` libraries, or anything that calls a model.

A gesture is committed once. Drag samples and keystrokes stay out of the journal: one move is one
`move` op, one closed text edit is one `set-text` op. Undo is the inverse Immer patch of that same
gesture. Reordering slides is a deck operation in this package. It is not a `PatchOp` and it is not
an engine contract. `repattern` is not produced here.

`immer` is pinned to `11.1.18`, the published v11 release. The snapshot whose own `package.json`
says `10.0.3-beta` is a different commit and is not this package.
