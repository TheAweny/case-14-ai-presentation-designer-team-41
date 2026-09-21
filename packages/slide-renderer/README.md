# @lct/slide-renderer

Renders the slide IR produced by the engine into React elements: the same components back the
in-browser preview and the HTML export, so what the user approves is what gets exported.

- Can import: `react`, `@lct/contracts`, `@visx/shape` and the `@visx/*` packages it needs
  (`group`, `scale`, `curve`, `vendor`).
- Must not import: `@lct/pipeline`, `@lct/engine-client`, apps, anything that calls a model.
- Contract: the component receives one slide of the IR plus the template profile (colors, fonts,
  grid) and renders it with no template-specific branching — everything visual comes from the
  profile, never from a hardcoded template name.

What is in it:

- `SlideFrame` — the box a slide is drawn in: the template's proportions and a size container.
  Children are placed with `boxStyle` in percentages of the slide and sized in `cqw` via
  `ptToCqw` / `emuToCqw`, so a slide looks the same as a thumbnail and on the canvas.
- `SlideSchematic` — a slide drawn as its structure, in one ink (`currentColor`, or
  `--schematic-ink`; `--schematic-surface` paints the slide). Text lines are estimated from the
  real copy, charts and tables from their data. Used where the real rendering is not available.
- `SlideView` — the real renderer for the canvas and HTML export: text, pictures
  (`contain` / `cover`), tables, visx charts, decoration targets and an overflow mark.
  Thumbnails stay on `SlideSchematic`.
