"""Temporary contracts that are not part of the MVP schema registry yet.

The shared contracts required by the local run protocol are generated in ``_generated.py``.
Only rendering-specific values remain provisional until their Zod schemas are introduced.
"""

from typing import Any

#: Draft profile straight out of the parser, before it is normalised and cached.
type TemplateProfileDraft = dict[str, Any]

#: Description of a chart to draw with native shapes.
type ChartSpec = dict[str, Any]

#: Description of a table to draw with native shapes.
type TableSpec = dict[str, Any]

#: Tree of native shapes produced by the visuals layer.
type ShapeTree = dict[str, Any]
