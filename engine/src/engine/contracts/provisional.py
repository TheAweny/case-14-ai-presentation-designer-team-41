"""Provisional aliases for contracts that are not in the Zod registry yet.

Every alias here is replaced by a generated Pydantic model from ``_generated.py`` as soon as the
matching Zod schema lands in ``packages/contracts``. They exist so the layer signatures already
say what they take and return.
"""

from typing import Any

#: Design system extracted from an uploaded template: palette, type scale, grid, layouts.
type TemplateProfile = dict[str, Any]

#: Draft profile straight out of the parser, before it is normalised and cached.
type TemplateProfileDraft = dict[str, Any]

#: Deck plan: the slide-by-slide intent, computed once and reused by every layout variant.
type DeckPlan = dict[str, Any]

#: Intermediate representation of one slide: boxes, text runs, visuals, all in template units.
type SlideIR = dict[str, Any]

#: Description of a chart to draw with native shapes.
type ChartSpec = dict[str, Any]

#: Description of a table to draw with native shapes.
type TableSpec = dict[str, Any]

#: Tree of native shapes produced by the visuals layer.
type ShapeTree = dict[str, Any]

#: One audit finding: which check fired, on which slide, and how bad it is.
type AuditFinding = dict[str, Any]
