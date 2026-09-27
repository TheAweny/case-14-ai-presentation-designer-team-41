"""Reusable layout patterns: the arrangements a template offers, with slots and capacity.

A pattern is what a layout places on the slide once the master's fixed artwork is set aside:
its placeholders, each with a semantic role, a box and a rough text capacity. Layouts that
place the same roles in the same boxes are one pattern, however many names they carry.

Nothing here knows any particular template. Roles come from placeholder types, intents from
which roles a pattern combines and how they sit, capacity from box sizes and the type scale.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Any

from engine.parser._model import EMU_PER_PT, Box, Shape, SlideLike, TemplateIR

__all__ = ["build_pattern_catalog"]

# Placeholder types, as the parser names them, mapped onto the slot roles of the contract.
# Anything not listed (dates, org charts, vertical text) is left to the layout's own drawing.
_ROLE_OF_PLACEHOLDER = {
    "title": "title",
    "center-title": "title",
    "vertical-title": "title",
    "subtitle": "subtitle",
    "body": "body",
    "object": "body",
    "picture": "image",
    "bitmap": "image",
    "clip-art": "image",
    "media-clip": "image",
    "chart": "chart",
    "table": "table",
    "footer": "footer",
    "slide-number": "page-number",
}

# Roles that carry content, as opposed to the running chrome every slide repeats.
_CONTENT_ROLES = frozenset({"title", "subtitle", "body", "image", "chart", "table"})
_TEXT_ROLES = frozenset({"title", "subtitle", "body", "footer"})

# Type scale entries that set the size of text in a slot of each role, nearest first. A
# template that states no subtitle size still sets its subtitles in some size, and the body or
# caption size is the best guess the type scale has.
_SCALE_ROLES = {
    "title": ("title",),
    "subtitle": ("subtitle", "heading", "body"),
    "body": ("body", "bullet"),
    "footer": ("footer", "caption", "body"),
}

# Average glyph width as a share of the font size, for proportional Latin and Cyrillic text.
_GLYPH_WIDTH_EM = 0.5
_DEFAULT_LINE_SPACING = 1.2

# Boxes are compared on a grid of this share of the slide, so that layouts nudged by a few
# EMU still count as one arrangement.
_GRID_SHARE = 0.01

# Two slots whose vertical extents overlap by at least this share sit side by side.
_SIDE_BY_SIDE = 0.5

# Height of the title band in the fallback arrangement, as a share of the slide.
_FALLBACK_TITLE_SHARE = 0.15


@dataclass(frozen=True, slots=True)
class _Slot:
    role: str
    box: Box
    size_pt: float | None


def _slots_of(layout: SlideLike, ir: TemplateIR) -> list[_Slot]:
    """Placeholders of a layout that land on the slide, as role-tagged boxes."""
    slots: list[_Slot] = []
    for shape in layout.shapes:
        if shape.placeholder is None or shape.box is None:
            continue
        role = _ROLE_OF_PLACEHOLDER.get(shape.placeholder.type)
        if role is None or not _visible(shape.box, ir):
            continue
        slots.append(_Slot(role=role, box=shape.box, size_pt=_stated_size(shape)))
    return _reading_order(slots, ir)


def _visible(box: Box, ir: TemplateIR) -> bool:
    return (
        box.cx > 0
        and box.cy > 0
        and box.x + box.cx > 0
        and box.y + box.cy > 0
        and box.x < ir.slide_cx
        and box.y < ir.slide_cy
    )


def _stated_size(shape: Shape) -> float | None:
    """Font size the layout states for its sample text, when it states one."""
    for paragraph in shape.paragraphs:
        for run in paragraph.runs:
            if run.size_pt:
                return run.size_pt
    return None


def _reading_order(slots: list[_Slot], ir: TemplateIR) -> list[_Slot]:
    """Top to bottom, then left to right within a band of roughly equal tops."""
    band = max(1, int(ir.slide_cy * _GRID_SHARE * 5))
    return sorted(slots, key=lambda s: (s.box.y // band, s.box.x, s.role))


def _signature(slots: list[_Slot], ir: TemplateIR) -> tuple[tuple[str, int, int, int, int], ...]:
    """Roles and snapped boxes, which is what makes two layouts the same arrangement."""
    gx = max(1, int(ir.slide_cx * _GRID_SHARE))
    gy = max(1, int(ir.slide_cy * _GRID_SHARE))
    return tuple(
        (
            s.role,
            round(s.box.x / gx),
            round(s.box.y / gy),
            round(s.box.cx / gx),
            round(s.box.cy / gy),
        )
        for s in slots
    )


def _side_by_side(a: Box, b: Box) -> bool:
    top = max(a.y, b.y)
    bottom = min(a.y + a.cy, b.y + b.cy)
    shared = max(0, bottom - top)
    horizontal_gap = a.x + a.cx <= b.x or b.x + b.cx <= a.x
    return horizontal_gap and shared >= _SIDE_BY_SIDE * min(a.cy, b.cy)


def _intents(slots: list[_Slot]) -> list[str]:
    """Plan intents a pattern can serve, read off the roles it combines."""
    roles = Counter(s.role for s in slots)
    bodies = [s.box for s in slots if s.role == "body"]
    intents: set[str] = set()

    if roles["chart"]:
        intents.add("chart")
    if roles["table"]:
        intents.add("table")
    if roles["image"]:
        intents.add("image")

    in_a_row = max(
        (sum(1 for other in bodies if other is box or _side_by_side(box, other)) for box in bodies),
        default=0,
    )
    if in_a_row >= 3:
        intents.update({"kpi", "two-column"})
    elif in_a_row == 2:
        intents.add("two-column")
    if len(bodies) >= 1:
        intents.update({"bullets", "agenda", "statement", "quote"})
    if not bodies and not roles["chart"] and not roles["table"] and roles["title"]:
        intents.update({"section", "closing", "statement"})
        if roles["subtitle"]:
            intents.add("title")
    return sorted(intents)


def _size_for(slot: _Slot, scale: dict[str, dict[str, Any]]) -> tuple[float, float] | None:
    """Font size and line spacing text in this slot is set in."""
    entry = next((scale[r] for r in _SCALE_ROLES.get(slot.role, ()) if r in scale), None)
    size = slot.size_pt or (entry or {}).get("sizePt")
    if not size:
        return None
    spacing = (entry or {}).get("lineSpacing") or _DEFAULT_LINE_SPACING
    return float(size), float(spacing)


def _max_chars(slot: _Slot, scale: dict[str, dict[str, Any]]) -> int | None:
    """Rough number of characters that fit, or None for slots that hold no text."""
    if slot.role not in _TEXT_ROLES:
        return None
    sizing = _size_for(slot, scale)
    if sizing is None:
        return None
    size_pt, spacing = sizing
    width_pt = slot.box.cx / EMU_PER_PT
    height_pt = slot.box.cy / EMU_PER_PT
    per_line = int(width_pt / (size_pt * _GLYPH_WIDTH_EM))
    lines = int(height_pt / (size_pt * spacing))
    return max(1, per_line * max(1, lines))


def _density(slots: list[_Slot], ir: TemplateIR) -> float:
    area = ir.slide_cx * ir.slide_cy
    if not area:
        return 0.0
    covered = sum(s.box.cx * s.box.cy for s in slots if s.role in _CONTENT_ROLES)
    return round(min(1.0, covered / area), 4)


def _slot_ids(slots: list[_Slot]) -> list[str]:
    """Role name, numbered when a role repeats, so ids survive re-imports of the template."""
    totals = Counter(s.role for s in slots)
    seen: Counter[str] = Counter()
    ids = []
    for s in slots:
        seen[s.role] += 1
        ids.append(s.role if totals[s.role] == 1 else f"{s.role}-{seen[s.role]}")
    return ids


def _optional(slots: list[_Slot]) -> list[bool]:
    """Title and the first content slot are required, the rest may stay empty."""
    first_content = next(
        (i for i, s in enumerate(slots) if s.role in _CONTENT_ROLES - {"title", "subtitle"}),
        None,
    )
    return [not (s.role == "title" or i == first_content) for i, s in enumerate(slots)]


def _pattern_name(slots: list[_Slot]) -> str:
    roles = Counter(s.role for s in slots if s.role in _CONTENT_ROLES)
    parts = [
        role if roles[role] == 1 else f"{roles[role]}{role}"
        for role in ("title", "subtitle", "body", "image", "chart", "table")
        if roles[role]
    ]
    return re.sub(r"[^a-z0-9-]", "", "-".join(parts)) or "chrome"


def _fallback(design_system: dict[str, Any]) -> list[_Slot]:
    """Title over body inside the grid's margins, for a template whose layouts place nothing."""
    grid = design_system["grid"]
    width = grid["slideCx"] - grid["marginLeft"] - grid["marginRight"]
    title_height = max(grid["baseline"] * 3, int(grid["slideCy"] * _FALLBACK_TITLE_SHARE))
    body_top = grid["marginTop"] + title_height + grid["baseline"]
    return [
        _Slot(
            role="title",
            box=Box(x=grid["marginLeft"], y=grid["marginTop"], cx=width, cy=title_height),
            size_pt=None,
        ),
        _Slot(
            role="body",
            box=Box(
                x=grid["marginLeft"],
                y=body_top,
                cx=width,
                cy=grid["slideCy"] - body_top - grid["marginBottom"],
            ),
            size_pt=None,
        ),
    ]


def build_pattern_catalog(
    ir: TemplateIR, template_hash: str, design_system: dict[str, Any]
) -> dict[str, Any]:
    """Collect the reusable arrangements of a template.

    Args:
        ir: The parsed template.
        template_hash: Hash of the IR, so the catalog can be matched with its design system.
        design_system: The design system of the same template, whose type scale sets the text
            capacity of each slot.

    Returns:
        A payload matching the shared ``PatternCatalog`` contract. ``occurrences`` counts the
        layouts showing an arrangement plus the template's slides built on them.
    """
    scale = {entry["role"]: entry for entry in design_system.get("typeScale", [])}
    used_by = Counter(slide.follows for slide in ir.slides)

    groups: dict[tuple[Any, ...], dict[str, Any]] = {}
    for layout in ir.layouts:
        slots = _slots_of(layout, ir)
        if not any(s.role in _CONTENT_ROLES for s in slots):
            continue
        group = groups.setdefault(
            _signature(slots, ir), {"slots": slots, "parts": [], "occurrences": 0}
        )
        group["parts"].append(layout.part)
        group["occurrences"] += 1 + used_by[layout.part]

    if not groups:
        master_parts = [m.part for m in ir.masters] or [ir.source_name]
        slots = _fallback(design_system)
        groups[()] = {"slots": slots, "parts": master_parts[:1], "occurrences": 1}

    names: Counter[str] = Counter()
    patterns = []
    for group in groups.values():
        slots = group["slots"]
        name = _pattern_name(slots)
        names[name] += 1
        pattern_id = name if names[name] == 1 else f"{name}-{names[name]}"
        patterns.append(
            {
                "patternId": pattern_id,
                "sourceParts": sorted(group["parts"]),
                "intents": _intents(slots),
                "slots": [
                    {
                        "slotId": slot_id,
                        "role": s.role,
                        "box": {"x": s.box.x, "y": s.box.y, "cx": s.box.cx, "cy": s.box.cy},
                        "optional": optional,
                        "maxChars": _max_chars(s, scale),
                    }
                    for s, slot_id, optional in zip(
                        slots, _slot_ids(slots), _optional(slots), strict=True
                    )
                ],
                "occurrences": group["occurrences"],
                "density": _density(slots, ir),
            }
        )

    return {"schemaVersion": 1, "templateHash": template_hash, "patterns": patterns}
