"""Temporary contracts that are not part of the MVP schema registry yet.

Every alias here is replaced by a generated Pydantic model from ``_generated.py`` as soon as the
matching Zod schema lands in ``packages/contracts``. They exist so the layer signatures already
say what they take and return.

The list only shrinks. ``DeckPlan``, ``SlideIR`` and ``AuditFinding`` used to live here and are
now generated; what is left is the shapes the visuals layer passes around internally, which have
no consumer on the TypeScript side and so have no reason to be in the shared registry.
"""

from typing import Any

#: Template profile: the design system and the pattern catalogue as one cached object.
#: Superseded by ``DesignSystem`` plus ``PatternCatalog`` once the profiler assembles them.
type TemplateProfile = dict[str, Any]

#: Draft profile straight out of the parser, before it is normalised and cached. Matches the
#: ``TemplateIR`` contract as a plain dictionary; the parser returns JSON, not a model.
type TemplateProfileDraft = dict[str, Any]

#: Description of a chart to draw with native shapes.
type ChartSpec = dict[str, Any]

#: Description of a table to draw with native shapes.
type TableSpec = dict[str, Any]

#: Tree of native shapes produced by the visuals layer.
type ShapeTree = dict[str, Any]
