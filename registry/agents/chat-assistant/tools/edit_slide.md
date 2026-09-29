Change the text of one object on a slide of a deck open in the editor. Use it when the person asks
to rewrite, shorten, translate or fix the text of an object they attached to their message.
`deckId`, `slideNumber` and `elementId` come from that attachment (`kind: slides`); objects the
person did not attach cannot be edited. `text` is the whole new text of the object: one line per
paragraph, separated by `\n`, no markdown. Keep it about as long as the old text so it fits the
same box, and keep the facts: do not add numbers, names or dates the person did not give. The
editor writes the text into the draft of the deck; the person sees it on the slide and can undo
it. Call it once per object; after the calls, say in one sentence what you changed.
