# engine.parser

Reads an arbitrary .pptx and derives the design system behind it: palette, type scale, grid,
master layouts and recurring shape patterns.

- Can import: `engine.contracts`, python-pptx, the standard library.
- Must not import: any other engine layer, any model client.
- Never branches on a template name or on hardcoded colors, fonts or coordinates.
