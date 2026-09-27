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

__all__ = [
    "VARIANTS",
    "Variant",
    "build_slide_ir",
    "build_variants",
    "fingerprint",
    "select_pattern",
]

Variant = Literal["dense", "balanced", "airy"]

#: The three renderings of one plan, in the order they are shown.
VARIANTS: tuple[Variant, ...] = ("dense", "balanced", "airy")

EMU_PER_PT = 12_700

# Text is measured the way the audit measures it (engine.checks): an average glyph of 0.55 em,
# wrapped at word boundaries, a single line 1.2 times the size, inside the default OOXML insets.
# The parser states slot capacity with the same glyph width. A text the layout calls fitting
# must not come back from the audit as overflowing.
_GLYPH_WIDTH_EM = 0.55
_SINGLE_LINE = 1.2
_INSET_X = 2 * 91_440
_INSET_Y = 2 * 45_720

# Type scale entries for text in each slot role, nearest first.
_SCALE_ROLES = {
    "title": ("title",),
    "subtitle": ("subtitle", "heading", "body"),
    "body": ("body", "bullet"),
    "footer": ("footer", "caption", "body"),
    "kpi-value": ("kpi-value", "title"),
    "kpi-caption": ("kpi-caption", "caption", "body"),
}

_TEXT_BLOCKS = frozenset({"paragraph", "bullets", "quote"})

# Slots for visuals, named as the plan blocks that fill them.
_VISUAL_SLOTS = frozenset({"image", "chart", "table"})

# Plan blocks laid out as tables, charts and figures rather than as lines of text.
_VISUAL_BLOCKS = frozenset({"table", "chart", "kpi"})

# Least size of the region a table or chart gets, as shares of the slide; a figure's value row
# is judged by the same height over its cells.
_MIN_VISUAL_HEIGHT = 0.25
_MIN_VISUAL_WIDTH = 0.3

# Share of a body slot its text keeps when a visual shares the slot.
_MIN_TEXT_SHARE = 0.2
_MAX_TEXT_SHARE = 0.5

# Type scale steps body copy may take per variant: dense the smallest of these, airy the
# largest that still fits.
_DENSE_STEPS = ("body", "bullet")
_AIRY_STEPS = ("body", "bullet", "subtitle")

# Dense splits a list of at least this many lines into two columns, when its slot is at least
# this share of the slide wide.
_DENSE_COLUMNS_FROM = 5
_DENSE_MIN_WIDTH = 0.5

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
        pattern = select_pattern(slide, catalog, variant, scale, grid)
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
                    "elements": _elements(slide, pattern, scale, variant, grid),
                }
            )
        )
    return slides


def build_variants(
    plan: DeckPlan,
    design_system: dict[str, Any],
    patterns: PatternCatalog | dict[str, Any] | None = None,
) -> dict[Variant, list[SlideIR]]:
    """Lay one plan out three times, once per variant, on the same template profile.

    The axis the variants differ on is density. Dense takes the template's fullest layouts,
    sets copy in its smallest body step and splits long lists into two columns; airy takes its
    sparsest layouts, the largest step that fits and centres short copy; balanced sits between.
    Text, facts and slide order are the same in all three.
    """
    return {variant: build_slide_ir(plan, design_system, patterns, variant) for variant in VARIANTS}


def fingerprint(slides: list[SlideIR]) -> tuple[tuple[Any, ...], ...]:
    """Composition of a deck with its words left out: two decks that look alike match."""
    result = []
    for slide in slides:
        parts = []
        for element in slide.elements:
            dumped = element.model_dump(mode="json")
            box = dumped["box"]
            sizes = sorted({r["sizePt"] for p in dumped.get("paragraphs") or [] for r in p["runs"]})
            parts.append(
                (
                    dumped["kind"],
                    dumped["role"],
                    box["x"],
                    box["y"],
                    box["cx"],
                    box["cy"],
                    tuple(sizes),
                    dumped.get("verticalAlign"),
                )
            )
        result.append((slide.patternId, tuple(parts)))
    return tuple(result)


def select_pattern(
    slide: Any,
    catalog: dict[str, Any],
    variant: Variant,
    scale: dict[str, dict[str, Any]] | None = None,
    grid: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Pick the pattern a planned slide is built on.

    A pattern qualifies only if it has a place for everything the slide carries: a title slot
    for the headline, a body for text, a subtitle or a body for the subhead. Anything else would
    drop copy without a signal. Qualifying patterns listing the slide's intent come first, then
    any qualifying pattern; among them, those that would leave a picture, chart or table slot
    empty give way to those that would not. Then those the copy fits come first, measured at the
    body step of the type scale when one is given, and each variant takes its own pattern by
    density (see `_by_variant`).

    Args:
        slide: A slide of the deck plan.
        catalog: Pattern catalog payload.
        variant: Rendering the slide is built for.
        scale: Type scale by role. Without it capacity comes from the catalog's `maxChars`.
        grid: Grid of the template. With it a table, chart or figure must get a region big
            enough to read.

    Returns:
        The chosen pattern payload.
    """
    patterns = catalog["patterns"]
    intent = _text(slide.intent)
    holding = [p for p in patterns if _holds(p, slide)]
    candidates = (
        [p for p in holding if intent in p["intents"]]
        or holding
        or [p for p in patterns if intent in p["intents"]]
        or [p for p in patterns if _has(p, "title")]
        or list(patterns)
    )
    candidates = [p for p in candidates if not _leaves_empty(p, slide)] or candidates
    fitting = [p for p in candidates if _fits(p, slide, scale, grid)] or candidates
    return _by_variant(fitting)[variant]


def _holds(pattern: dict[str, Any], slide: Any) -> bool:
    """Whether a pattern has somewhere to put each part of the slide."""
    wants_text = any(block.kind in _TEXT_BLOCKS for block in slide.blocks)
    if slide.headline and not _has(pattern, "title"):
        return False
    if wants_text and not _has(pattern, "body"):
        return False
    for block in slide.blocks:
        if block.kind in _VISUAL_BLOCKS and not (
            _has(pattern, block.kind) or _has(pattern, "body")
        ):
            return False
    return not slide.subhead or _has(pattern, "subtitle") or _has(pattern, "body")


def _visuals_have_room(
    pattern: dict[str, Any], slide: Any, scale: dict[str, dict[str, Any]], grid: dict[str, Any]
) -> bool:
    """Whether every table, chart or figure of the slide gets a region big enough to read."""
    if not any(block.kind in _VISUAL_BLOCKS for block in slide.blocks):
        return True
    elements = _elements(slide, pattern, scale, "balanced", grid)
    boxes = [e["box"] for e in elements if e["role"] in {"table", "chart"}]
    boxes += [e["box"] for e in elements if e["role"] == "kpi-value"]
    return all(
        box["cy"] >= grid["slideCy"] * _MIN_VISUAL_HEIGHT
        and box["cx"] >= grid["slideCx"] * _MIN_VISUAL_WIDTH / (2 if len(boxes) > 1 else 1)
        for box in boxes
        if box
    ) and bool(boxes)


def _leaves_empty(pattern: dict[str, Any], slide: Any) -> bool:
    """Whether a pattern has a required picture, chart or table slot the slide has nothing for."""
    kinds = {block.kind for block in slide.blocks}
    return any(
        slot["role"] in _VISUAL_SLOTS and not slot["optional"] and slot["role"] not in kinds
        for slot in pattern["slots"]
    )


def _fits(
    pattern: dict[str, Any],
    slide: Any,
    scale: dict[str, dict[str, Any]] | None,
    grid: dict[str, Any] | None = None,
) -> bool:
    """Whether the headline and the copy fit their slots, and visuals get room to be read."""
    if (
        scale is not None
        and grid is not None
        and not _visuals_have_room(pattern, slide, scale, grid)
    ):
        return False
    if scale is None:
        return _capacity(pattern) >= len(_body_text(slide)) and _title_capacity(pattern) >= len(
            slide.headline
        )
    title = next((slot for slot in pattern["slots"] if slot["role"] == "title"), None)
    if title and _overflow([slide.headline], title["box"], _style(scale, "title")):
        return False
    bodies = _main_bodies(pattern["slots"])
    columns = _distribute(slide, len(bodies))
    if bodies and slide.subhead and not _has(pattern, "subtitle"):
        columns[0] = [slide.subhead, *columns[0]]
    style = _style(scale, "body")
    return all(
        _overflow(lines, slot["box"], style) is None
        for slot, lines in zip(bodies, columns, strict=False)
        if lines
    )


def _by_variant(fitting: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Give each variant its own pattern, as far as the template offers different ones.

    Dense takes the densest, airy the sparsest, balanced one that is neither, nearest to the
    middle. With fewer than three candidates balanced shares a pattern, and the variants then
    differ in how the text sits in it. Ties go to the pattern the template uses most.
    """
    ranked = sorted(fitting, key=lambda p: (p["density"], -p["occurrences"], p["patternId"]))
    by_use = sorted(ranked, key=lambda p: (-p["occurrences"], p["patternId"]))
    densest = max(p["density"] for p in ranked)
    sparsest = min(p["density"] for p in ranked)
    dense = next(p for p in by_use if p["density"] == densest)
    airy = next(p for p in by_use if p["density"] == sparsest)
    middle = [p for p in ranked if p is not dense and p is not airy]
    if middle:
        target = (densest + sparsest) / 2
        balanced = min(middle, key=lambda p: (abs(p["density"] - target), -p["occurrences"]))
    else:
        balanced = by_use[0]
    return {"dense": dense, "balanced": balanced, "airy": airy}


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


def _title_capacity(pattern: dict[str, Any]) -> float:
    """Characters the title slot holds; a pattern without a title, or of unknown size, any."""
    titles = [slot["maxChars"] for slot in pattern["slots"] if slot["role"] == "title"]
    if not titles or titles[0] is None:
        return math.inf
    return float(titles[0])


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
    slide: Any,
    pattern: dict[str, Any],
    scale: dict[str, dict[str, Any]],
    variant: Variant = "balanced",
    grid: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    slots = pattern["slots"]
    body_slots = _main_bodies(slots)
    columns = iter(_distribute(slide, len(body_slots)))
    has_subtitle = any(slot["role"] == "subtitle" for slot in slots)

    texts: dict[str, list[str]] = {}
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
        texts[slot["slotId"]] = [line for line in lines if line]

    boxes = {slot["slotId"]: slot["box"] for slot in slots}
    visuals = _place_visuals(slide, slots, body_slots, texts, boxes, scale, grid)

    elements: list[dict[str, Any]] = []
    for slot in slots:
        role, lines = slot["role"], texts[slot["slotId"]]
        if not lines:
            continue
        box = boxes[slot["slotId"]]
        element_id = f"{slot['slotId']}-{slide.slideId}"
        if role != "body":
            elements.append(_text_element(element_id, role, box, lines, _style(scale, role)))
            continue
        style = _body_style(scale, variant, lines, box)
        split = _dense_columns(variant, lines, box, len(body_slots), grid)
        if split:
            for n, (part_box, part) in enumerate(split, start=1):
                elements.append(_text_element(f"{element_id}-col{n}", role, part_box, part, style))
            continue
        element = _text_element(element_id, role, box, lines, style)
        if variant == "airy" and element["overflow"] is None and _is_short(lines, box, style):
            element["verticalAlign"] = "middle"
        elements.append(element)
    return elements + visuals


def _place_visuals(
    slide: Any,
    slots: list[dict[str, Any]],
    body_slots: list[dict[str, Any]],
    texts: dict[str, list[str]],
    boxes: dict[str, dict[str, int]],
    scale: dict[str, dict[str, Any]],
    grid: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Find room for the slide's tables, charts and figures, and lay them out as data.

    A slot the template made for the kind comes first, then a body slot the text left free, and
    otherwise the last body slot with text is shared: the text keeps the top, as tall as it
    needs, and the visuals take the rest. Several visuals in one place sit side by side. Styling
    them from the template and drawing them natively is the visuals layer's part.
    """
    blocks = [block for block in slide.blocks if block.kind in _VISUAL_BLOCKS]
    if not blocks:
        return []
    gap = int(grid["gutter"]) if grid else 0
    regions: list[tuple[dict[str, int], list[Any]]] = []
    pending: list[Any] = []
    for block in blocks:
        own = next(
            (
                s
                for s in slots
                if s["role"] == block.kind and s["box"] not in (r for r, _ in regions)
            ),
            None,
        )
        if own is not None:
            regions.append((own["box"], [block]))
        else:
            pending.append(block)
    if pending:
        free = [s for s in body_slots if not texts[s["slotId"]]]
        if free:
            regions.append((free[0]["box"], pending))
        else:
            shared = next((s for s in reversed(body_slots) if texts[s["slotId"]]), None)
            if shared is None:
                shared = next((s for s in slots if s["role"] == "title"), slots[0])
                area = _below(shared["box"], grid)
            else:
                area = _share(shared, texts[shared["slotId"]], boxes, scale, gap)
            regions.append((area, pending))

    elements: list[dict[str, Any]] = []
    counter = 0
    for area, placed in regions:
        for box, block in zip(_side_by_side(area, len(placed), gap), placed, strict=True):
            counter += 1
            elements.extend(_visual(block, box, f"{block.kind}-{counter}-{slide.slideId}", scale))
    return elements


def _share(
    slot: dict[str, Any],
    lines: list[str],
    boxes: dict[str, dict[str, int]],
    scale: dict[str, dict[str, Any]],
    gap: int,
) -> dict[str, int]:
    """Split a body slot: text on top, as tall as it needs within bounds, visuals below."""
    box = slot["box"]
    style = _style(scale, "body")
    needed, _ = _line_budget(lines, box, style)
    line_emu = float(style["sizePt"]) * _SINGLE_LINE * EMU_PER_PT
    text_cy = int(needed * line_emu + _INSET_Y)
    text_cy = min(max(text_cy, int(box["cy"] * _MIN_TEXT_SHARE)), int(box["cy"] * _MAX_TEXT_SHARE))
    boxes[slot["slotId"]] = {**box, "cy": text_cy}
    top = box["y"] + text_cy + gap
    return {**box, "y": top, "cy": box["y"] + box["cy"] - top}


def _below(box: dict[str, int], grid: dict[str, Any] | None) -> dict[str, int]:
    """The area under a title, inside the grid, for a slide whose layout has no body at all."""
    if grid is None:
        return box
    top = box["y"] + box["cy"] + int(grid["baseline"])
    left = int(grid["marginLeft"])
    return {
        "x": left,
        "y": top,
        "cx": int(grid["slideCx"]) - left - int(grid["marginRight"]),
        "cy": max(int(grid["slideCy"]) - int(grid["marginBottom"]) - top, 1),
    }


def _side_by_side(area: dict[str, int], count: int, gap: int) -> list[dict[str, int]]:
    width = (area["cx"] - gap * (count - 1)) // count
    return [{**area, "x": area["x"] + i * (width + gap), "cx": width} for i in range(count)]


def _visual(
    block: Any, box: dict[str, int], element_id: str, scale: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    base = {"elementId": element_id, "box": box, "sourceShapeId": None}
    if block.kind == "table":
        return [
            {
                **base,
                "kind": "table",
                "role": "table",
                "headers": list(block.headers),
                "rows": [list(row) for row in block.rows],
            }
        ]
    if block.kind == "chart":
        return [
            {
                **base,
                "kind": "chart",
                "role": "chart",
                "chartType": _text(block.chartType),
                "categories": list(block.categories),
                "series": [{"name": s.name, "values": list(s.values)} for s in block.series],
                "xTitle": block.xTitle,
                "yTitle": block.yTitle,
            }
        ]
    return _kpis(block, box, element_id, scale)


def _kpis(
    block: Any, box: dict[str, int], element_id: str, scale: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    """Figures in a row: each a value over its caption, set in the template's figure styles."""
    value_style = _style(scale, "kpi-value")
    caption_style = _style(scale, "kpi-caption")
    cells = _side_by_side(box, len(block.items), 0)
    value_cy = min(
        int(float(value_style["sizePt"]) * _SINGLE_LINE * EMU_PER_PT + _INSET_Y), box["cy"] // 2
    )
    elements = []
    for n, (cell, item) in enumerate(zip(cells, block.items, strict=True), start=1):
        value_box = {**cell, "cy": value_cy}
        caption_box = {**cell, "y": cell["y"] + value_cy, "cy": cell["cy"] - value_cy}
        elements.append(
            _text_element(
                f"{element_id}-{n}-value", "kpi-value", value_box, [item.value], value_style
            )
        )
        elements.append(
            _text_element(
                f"{element_id}-{n}-caption",
                "kpi-caption",
                caption_box,
                [item.caption],
                caption_style,
            )
        )
    return elements


def _text_element(
    element_id: str, role: str, box: dict[str, int], lines: list[str], style: dict[str, Any]
) -> dict[str, Any]:
    return {
        "elementId": element_id,
        "kind": "text",
        "role": role,
        "sourceShapeId": None,
        "box": box,
        "paragraphs": [_paragraph(line, style) for line in lines],
        "overflow": _overflow(lines, box, style),
    }


def _body_style(
    scale: dict[str, dict[str, Any]], variant: Variant, lines: list[str], box: dict[str, int]
) -> dict[str, Any]:
    """Style of body copy per variant, always a step of the template's own type scale.

    Dense sets copy in the smallest body step, airy in the largest step up to the subtitle that
    still fits the box, balanced in the body step itself.
    """
    balanced = _style(scale, "body")
    if variant == "dense":
        steps = [scale[r] for r in _DENSE_STEPS if r in scale]
        return min(steps, key=lambda s: float(s["sizePt"]), default=balanced)
    if variant == "airy":
        steps = [scale[r] for r in _AIRY_STEPS if r in scale]
        fitting = [s for s in steps if _overflow(lines, box, s) is None]
        return max(fitting, key=lambda s: float(s["sizePt"]), default=balanced)
    return balanced


def _dense_columns(
    variant: Variant,
    lines: list[str],
    box: dict[str, int],
    bodies: int,
    grid: dict[str, Any] | None,
) -> list[tuple[dict[str, int], list[str]]] | None:
    """A long list in one wide slot, split into two columns by the grid gutter, for dense."""
    if variant != "dense" or grid is None or bodies != 1 or len(lines) < _DENSE_COLUMNS_FROM:
        return None
    if box["cx"] < grid["slideCx"] * _DENSE_MIN_WIDTH:
        return None
    gutter = int(grid["gutter"])
    width = (box["cx"] - gutter) // 2
    half = math.ceil(len(lines) / 2)
    left = {**box, "cx": width}
    right = {**box, "x": box["x"] + width + gutter, "cx": width}
    return [(left, lines[:half]), (right, lines[half:])]


def _is_short(lines: list[str], box: dict[str, int], style: dict[str, Any]) -> bool:
    needed, available = _line_budget(lines, box, style)
    return needed * 2 <= available


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


def _line_budget(lines: list[str], box: dict[str, int], style: dict[str, Any]) -> tuple[int, int]:
    """Lines the text needs at a style, and lines the box holds."""
    size_pt = float(style["sizePt"])
    line_pt = size_pt * _SINGLE_LINE * float(style.get("lineSpacing") or 1.0)
    width_pt = max(box["cx"] - _INSET_X, 1) / EMU_PER_PT
    height_pt = max(box["cy"] - _INSET_Y, 0) / EMU_PER_PT
    per_line = max(1, int(width_pt / (size_pt * _GLYPH_WIDTH_EM)))
    available = max(1, int(height_pt / line_pt))
    needed = sum(max(1, _wrapped(line, per_line)) for line in lines)
    return needed, available


def _wrapped(text: str, per_line: int) -> int:
    """Lines a text takes when wrapped at word boundaries, long words broken."""
    count, current = 1, 0
    for word in text.split():
        length = len(word)
        if current == 0:
            current = length
        elif current + 1 + length <= per_line:
            current += 1 + length
        else:
            count += 1
            current = length
        while current > per_line:
            count += 1
            current -= per_line
    return count


def _overflow(
    lines: list[str], box: dict[str, int], style: dict[str, Any]
) -> dict[str, int] | None:
    """Lines the text needs beyond what the box holds, or None when it fits."""
    needed, available = _line_budget(lines, box, style)
    if needed <= available:
        return None
    line_pt = float(style["sizePt"]) * _SINGLE_LINE * float(style.get("lineSpacing") or 1.0)
    extra = needed - available
    return {"lines": extra, "emu": int(extra * line_pt * EMU_PER_PT)}


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
