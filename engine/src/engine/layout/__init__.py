"""Layout layer: places a deck plan onto slides, deterministically.

Given a plan and a template profile the layer produces the slide IR. Each slide is built on one
of the template's own patterns: the one whose intents cover the slide's intent, whose text slots
can hold the copy, and whose density suits the variant. The layer never rewrites text: when a
block does not fit it reports an overflow signal, and the agent on the TypeScript side decides
how to shorten the copy.
"""

from __future__ import annotations

import math
from typing import Any, Literal

from engine.contracts import DeckPlan, PatternCatalog, SlideIR

__all__ = ["Variant", "build_slide_ir", "select_pattern"]

Variant = Literal["dense", "balanced", "airy"]

EMU_PER_PT = 12_700

# Average glyph width as a share of the font size, the same estimate the parser uses to state
# slot capacity, so that a text the catalog says fits is also laid out as fitting.
_GLYPH_WIDTH_EM = 0.5
_DEFAULT_LINE_SPACING = 1.2

# Type scale entries for text in each slot role, nearest first.
_SCALE_ROLES = {
    "title": ("title",),
    "subtitle": ("subtitle", "heading", "body"),
    "body": ("body", "bullet"),
    "footer": ("footer", "caption", "body"),
}

_TEXT_BLOCKS = frozenset({"paragraph", "bullets", "quote"})

# A body slot smaller than this share of the largest one is a heading, not a column.
_MAIN_BODY_SHARE = 0.5


def build_slide_ir(
    plan: DeckPlan,
    design_system: dict[str, Any],
    patterns: PatternCatalog | dict[str, Any] | None = None,
    variant: Variant = "balanced",
) -> list[SlideIR]:
    """Lay the deck plan out against the template profile.

    Args:
        plan: Deck plan produced once per run and reused by every layout variant.
        design_system: Validated design system extracted from the template.
        patterns: Pattern catalog of the same template. Without it every slide is a title over
            a body inside the grid's margins.
        variant: Which of the three renderings to build. Dense prefers the patterns that cover
            most of the slide, airy the ones that cover least, balanced the middle ground.

    Returns:
        One IR entry per slide, each carrying its overflow signals.
    """
    catalog = _catalog(patterns, design_system)
    grid = design_system["grid"]
    scale = {entry["role"]: entry for entry in design_system["typeScale"]}
    slides: list[SlideIR] = []
    for index, slide in enumerate(plan.slides):
        pattern = select_pattern(slide, catalog, variant)
        slides.append(
            SlideIR.model_validate(
                {
                    "schemaVersion": 1,
                    "slideId": slide.slideId,
                    "variant": variant,
                    "index": index,
                    "patternId": pattern["patternId"],
                    "slideCx": grid["slideCx"],
                    "slideCy": grid["slideCy"],
                    "elements": _elements(slide, pattern, scale),
                }
            )
        )
    return slides


def select_pattern(slide: Any, catalog: dict[str, Any], variant: Variant) -> dict[str, Any]:
    """Pick the pattern a planned slide is built on.

    Candidates are the patterns listing the slide's intent. When none does, any pattern with a
    body slot will do for a slide with text, and any pattern with a title otherwise. Among the
    candidates, those whose text slots can hold the copy come first, then the variant decides by
    density, and ties go to the pattern the template uses most.

    Args:
        slide: A slide of the deck plan.
        catalog: Pattern catalog payload.
        variant: Rendering the slide is built for.

    Returns:
        The chosen pattern payload.
    """
    patterns = catalog["patterns"]
    wants_text = any(block.kind in _TEXT_BLOCKS for block in slide.blocks)
    intent = _text(slide.intent)
    candidates = [p for p in patterns if intent in p["intents"]]
    if not candidates and wants_text:
        candidates = [p for p in patterns if _has(p, "body")]
    if not candidates:
        candidates = [p for p in patterns if _has(p, "title")] or list(patterns)

    length = len(_body_text(slide))
    fitting = [p for p in candidates if _capacity(p) >= length] or candidates

    by_density = sorted(fitting, key=lambda p: (p["density"], -p["occurrences"], p["patternId"]))
    if variant == "dense":
        best = max(p["density"] for p in by_density)
    elif variant == "airy":
        best = min(p["density"] for p in by_density)
    else:
        best = by_density[(len(by_density) - 1) // 2]["density"]
    tied = [p for p in by_density if p["density"] == best]
    return min(tied, key=lambda p: (-p["occurrences"], p["patternId"]))


def _catalog(
    patterns: PatternCatalog | dict[str, Any] | None, design_system: dict[str, Any]
) -> dict[str, Any]:
    if isinstance(patterns, PatternCatalog):
        return patterns.model_dump()
    if patterns is not None:
        return patterns
    grid = design_system["grid"]
    width = grid["slideCx"] - grid["marginLeft"] - grid["marginRight"]
    title_height = max(grid["baseline"] * 3, int(grid["slideCy"] * 0.15))
    body_top = grid["marginTop"] + title_height + grid["baseline"]
    return {
        "patterns": [
            {
                "patternId": "generated-text",
                "intents": [],
                "occurrences": 1,
                "density": 0.0,
                "slots": [
                    {
                        "slotId": "title",
                        "role": "title",
                        "optional": False,
                        "maxChars": None,
                        "box": {
                            "x": grid["marginLeft"],
                            "y": grid["marginTop"],
                            "cx": width,
                            "cy": title_height,
                        },
                    },
                    {
                        "slotId": "body",
                        "role": "body",
                        "optional": False,
                        "maxChars": None,
                        "box": {
                            "x": grid["marginLeft"],
                            "y": body_top,
                            "cx": width,
                            "cy": grid["slideCy"] - body_top - grid["marginBottom"],
                        },
                    },
                ],
            }
        ]
    }


def _has(pattern: dict[str, Any], role: str) -> bool:
    return any(slot["role"] == role for slot in pattern["slots"])


def _capacity(pattern: dict[str, Any]) -> float:
    """Characters the body slots hold together; unknown capacity counts as unlimited."""
    bodies = [slot["maxChars"] for slot in pattern["slots"] if slot["role"] == "body"]
    if not bodies or any(chars is None for chars in bodies):
        return math.inf if bodies else 0
    return float(sum(bodies))


def _text(value: Any) -> str:
    """Plain string of a generated model value: root models and enums carry theirs inside."""
    value = getattr(value, "root", value)
    return str(getattr(value, "value", value))


def _body_text(slide: Any) -> str:
    return "\n".join(line for block in slide.blocks for line in _lines(block))


def _lines(block: Any) -> list[str]:
    """A text block as the lines it is set in; visual blocks are drawn by the visuals layer."""
    if block.kind == "paragraph":
        return [block.text]
    if block.kind == "bullets":
        return [_text(item) for item in block.items]
    if block.kind == "quote":
        return [block.text, block.attribution] if block.attribution else [block.text]
    return []


def _distribute(slide: Any, bodies: int) -> list[list[str]]:
    """Split the slide's text blocks over its body slots, in reading order.

    With as many blocks as slots each block gets its own slot. With a single bullet list and
    several slots the items are split evenly, which is what a two-column slide of one list means.
    Otherwise the last slot takes whatever the others could not.
    """
    blocks = [block for block in slide.blocks if block.kind in _TEXT_BLOCKS]
    if bodies <= 0:
        return []
    if len(blocks) == 1 and blocks[0].kind == "bullets" and bodies > 1:
        items = [_text(item) for item in blocks[0].items]
        per = math.ceil(len(items) / bodies)
        return [items[i * per : (i + 1) * per] for i in range(bodies)]
    columns: list[list[str]] = [[] for _ in range(bodies)]
    for i, block in enumerate(blocks):
        columns[min(i, bodies - 1)].extend(_lines(block))
    return columns


def _elements(
    slide: Any, pattern: dict[str, Any], scale: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    slots = pattern["slots"]
    body_slots = _main_bodies(slots)
    columns = iter(_distribute(slide, len(body_slots)))
    has_subtitle = any(slot["role"] == "subtitle" for slot in slots)

    elements: list[dict[str, Any]] = []
    for slot in slots:
        role = slot["role"]
        if role == "title":
            lines = [slide.headline]
        elif role == "subtitle":
            lines = [slide.subhead] if slide.subhead else []
        elif role == "body":
            lines = next(columns, []) if slot in body_slots else []
            if body_slots and slot is body_slots[0] and slide.subhead and not has_subtitle:
                lines = [slide.subhead, *lines]
        else:
            # Footers and page numbers are the template's running chrome; a static number
            # would stop updating the moment someone reorders the slides.
            lines = []
        lines = [line for line in lines if line]
        if not lines:
            continue
        style = _style(scale, role)
        elements.append(
            {
                "elementId": f"{slot['slotId']}-{slide.slideId}",
                "kind": "text",
                "role": role,
                "sourceShapeId": None,
                "box": slot["box"],
                "paragraphs": [_paragraph(line, style) for line in lines],
                "overflow": _overflow(lines, slot["box"], style),
            }
        )
    return elements


def _main_bodies(slots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Body slots that carry the copy, leaving out small ones such as column headers.

    A layout comparing two things often puts a short heading body above each column. Those are
    much smaller than the columns themselves, and filling them with list items would read as
    headings, so text goes only to bodies at least half the size of the largest one.
    """
    bodies = [slot for slot in slots if slot["role"] == "body"]
    if not bodies:
        return []
    largest = max(slot["box"]["cx"] * slot["box"]["cy"] for slot in bodies)
    return [
        slot
        for slot in bodies
        if slot["box"]["cx"] * slot["box"]["cy"] >= _MAIN_BODY_SHARE * largest
    ]


def _style(scale: dict[str, dict[str, Any]], role: str) -> dict[str, Any]:
    for name in _SCALE_ROLES.get(role, ("body",)):
        if name in scale:
            return scale[name]
    return next(iter(scale.values()))


def _overflow(
    lines: list[str], box: dict[str, int], style: dict[str, Any]
) -> dict[str, int] | None:
    """Lines the text needs beyond what the box holds, or None when it fits."""
    size_pt = float(style["sizePt"])
    spacing = float(style.get("lineSpacing") or _DEFAULT_LINE_SPACING)
    per_line = max(1, int(box["cx"] / EMU_PER_PT / (size_pt * _GLYPH_WIDTH_EM)))
    available = max(1, int(box["cy"] / EMU_PER_PT / (size_pt * spacing)))
    needed = sum(max(1, math.ceil(len(line) / per_line)) for line in lines)
    if needed <= available:
        return None
    extra = needed - available
    return {"lines": extra, "emu": int(extra * size_pt * spacing * EMU_PER_PT)}


def _paragraph(text: str, style: dict[str, Any]) -> dict[str, Any]:
    return {
        "level": 0,
        "lineSpacing": style["lineSpacing"],
        "runs": [
            {
                "text": text,
                "font": style["font"],
                "sizePt": style["sizePt"],
                "bold": style["bold"],
                "italic": style["italic"],
                "color": "",
            }
        ],
    }
