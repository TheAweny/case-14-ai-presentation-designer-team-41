# @lct/slide-renderer

Renders the slide IR produced by the engine into React elements: the same components back the
in-browser preview and the HTML export, so what the user approves is what gets exported.

- Can import: `react`, `@lct/contracts`.
- Must not import: `@lct/pipeline`, `@lct/engine-client`, apps, anything that calls a model.
- Contract: the component receives one slide of the IR plus the template profile (colors, fonts,
  grid) and renders it with no template-specific branching — everything visual comes from the
  profile, never from a hardcoded template name.
