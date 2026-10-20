# Brandbook demonstration fixtures

CC0 synthetic fixtures for the brandbook parser. They are deliberately small and distributable;
they do not copy the organizer dataset.

| File                      | Demonstrates                                                | Expected parser path                       |
| ------------------------- | ----------------------------------------------------------- | ------------------------------------------ |
| `tokens.json`             | DTCG-style colors, aliases, font families/sizes and spacing | JSON token extraction, alias evidence      |
| `guideline.pdf`           | Declared HEX colors, typography and usage rule              | PDF text/evidence extraction               |
| `symbol.svg`              | Vector logo, viewBox and fills                              | SVG asset/vector extraction                |
| `northstar.fig`           | Native binary Figma Kiwi v15 container                      | real `.fig` decoder and node normalization |
| `slide-example.pptx`      | Editable slide example                                      | existing PPTX parser adapter               |
| `northstar-brandbook.zip` | Packaged brandbook combining JSON, PDF, SVG and PPTX        | safe recursive archive extraction          |

Regenerate the deterministic files with:

```bash
uv run --with reportlab python examples/brandbooks/generate.py
uv run python examples/brandbooks/generate_fig.py
```

The parser must report evidence, confidence and limitations. An observed paint or font in a
sample is not automatically promoted to a semantic primary brand token.
