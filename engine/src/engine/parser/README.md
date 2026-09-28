# engine.parser

Reads an arbitrary .pptx and derives the design system behind it: palette, type scale, grid,
master layouts and recurring shape patterns.

- Can import: `engine.contracts`, python-pptx, the standard library.
- Must not import: any other engine layer, any model client.
- Never branches on a template name or on hardcoded colors, fonts or coordinates.

It also reads a finished deck back as SlideIR (`import_deck`, `slides.py`): every slide as it is
drawn, with what the master and layout put on it, text styles resolved through `p:txStyles` and
the placeholder chain, scheme colours through the colour map, and shape outlines as SVG paths
(`_geometry.py` evaluates guide formulas; `_presets.py` holds the ECMA-376 preset definitions).
