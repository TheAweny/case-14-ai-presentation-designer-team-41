"""Tables that keep every cell, align numbers, and report overflow instead of cutting."""

from __future__ import annotations

from typing import Any

from engine.visuals.measure import EMU_PER_PT, INSET_X, INSET_Y, FontBook, line_count
from engine.visuals.numbers import phrases
from engine.visuals.place import (
    carve_end,
    gutter_of,
    horizontal_split,
    palette_roles,
    text_element,
    type_step,
    vertical_split,
)

_HAIRLINE_EMU = 9_525
_ZERO_TEXT = {"0", "0.0", "0,0", "0.00", "0,00"}


def _shown(cell: dict[str, Any], words: dict[str, str], label: str) -> str:
    text = str(cell.get("text") or "")
    if cell.get("missing") and text.strip() in _ZERO_TEXT:
        raise ValueError(f"{label} is missing and cannot be shown as zero.")
    if cell.get("missing") and text == "":
        return words["missing"]
    return text


def _styles(
    kinds: list[str], row_count: int, roles: set[str]
) -> tuple[list[list[dict[str, Any]]], dict[str, Any]]:
    header: list[dict[str, Any]] = []
    body: list[dict[str, Any]] = []
    for kind in kinds:
        align = "right" if kind == "number" else "left"
        head: dict[str, Any] = {"bold": True, "align": align}
        if {"accent", "text-on-accent"} <= roles:
            head["fill"] = "accent"
            head["color"] = "text-on-accent"
        header.append(head)
        body.append({"align": align})
    styles = [header, *[[dict(item) for item in body] for _ in range(row_count)]]
    look: dict[str, Any] = {"headerRow": True}
    if row_count >= 3 and "surface" in roles:
        look["bandedRows"] = True
        look["bandFill"] = "surface"
    rule = "line" if "line" in roles else "text-muted" if "text-muted" in roles else None
    if rule is not None:
        look["borders"] = {
            "color": rule,
            "widthEmu": _HAIRLINE_EMU,
            "horizontal": True,
            "vertical": False,
            "outer": False,
        }
    return styles, look


def table_overflow(
    headers: list[str],
    rows: list[list[str]],
    box: dict[str, int],
    style: dict[str, Any],
    weights: list[int],
) -> dict[str, int] | None:
    """Height of the wrapped grid against the box. Nothing is removed when it does not fit."""
    total = sum(weights) or 1
    width = max(int(box["cx"]) - INSET_X, 1)
    columns = [max(int(width * weight / total), 1) for weight in weights]
    line_height = float(style["sizePt"]) * float(style.get("lineSpacing") or 1) * EMU_PER_PT

    def lines_for(values: list[str]) -> int:
        return max(
            (
                line_count(value, style["font"], float(style["sizePt"]), columns[index])
                for index, value in enumerate(values)
            ),
            default=1,
        )

    needed = lines_for(headers) + sum(lines_for(row) for row in rows)
    available = int(max(int(box["cy"]) - INSET_Y, 0) // line_height) if line_height else 0
    extra = max(0, needed - available)
    if extra <= 0:
        return None
    return {"lines": extra, "emu": int(extra * line_height)}


def make_table(
    element_id: str,
    box: dict[str, int],
    headers: list[str],
    rows: list[list[str]],
    kinds: list[str],
    roles: set[str],
    style: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, int] | None]:
    weights = [2 if kind == "text" else 1 for kind in kinds]
    styles, look = _styles(kinds, len(rows), roles)
    overflow = table_overflow(headers, rows, box, style, weights)
    element: dict[str, Any] = {
        "kind": "table",
        "elementId": element_id,
        "role": "table",
        "box": {key: int(box[key]) for key in ("x", "y", "cx", "cy")},
        "sourceShapeId": None,
        "headers": headers,
        "rows": rows,
        "columnWidths": weights,
        "headerRow": True,
        "cellStyles": styles,
        **look,
    }
    return element, overflow


def _note_lines(block: dict[str, Any], words: dict[str, str]) -> list[str]:
    lines: list[str] = []
    if str(block.get("notes") or ""):
        lines.append(str(block["notes"]))
    if block.get("caveat"):
        lines.append(str(block["caveat"]))
    for source in block["sources"]:
        lines.append(words["source"].format(item_id=source["itemId"], status=source["status"]))
        lines.append(str(source["quote"]))
    return lines or [words["notes"]]


def _regions(
    box: dict[str, int], variant: str, gutter: int
) -> tuple[dict[str, int], dict[str, int], str]:
    if variant == "dense":
        table, note = vertical_split(box, gutter, 0.72)
        return table, note, "chart-beside-table"
    if variant == "airy":
        note, table = horizontal_split(box, gutter, 0.28)
        return table, note, "table-above-chart"
    table, note = carve_end(box, 0.24)
    return table, note, "chart-above-table"


def build_table(
    request: dict[str, Any], book: FontBook
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, int] | None, str]:
    """A native table plus a note. Every input cell is still present when the box is too small."""
    block = request["block"]
    columns = block["columns"]
    width = len(columns)
    words = phrases(str(request["language"]))
    rows: list[list[str]] = []
    for index, row in enumerate(block["rows"], start=1):
        cells = row["cells"]
        if len(cells) != width:
            raise ValueError(f"Row {index} must be as wide as the header.")
        rows.append(
            [
                _shown(cell, words, f"row {index} column {column}")
                for column, cell in enumerate(cells, start=1)
            ]
        )
    design = request["designSystem"]
    variant = str(request["variant"])
    # Native table export uses the body's template step. Measure that same step.
    roles = ("body", "caption")
    style = type_step(design, roles)
    book.note(str(style["role"]), str(style["font"]))
    note_style = type_step(design, ("caption", "footer", "body"))
    book.note(str(note_style["role"]), str(note_style["font"]))
    table_box, note_box, placement = _regions(request["box"], variant, gutter_of(design))
    kinds = [column["kind"] for column in columns]
    table, overflow = make_table(
        f"{request['elementId']}-table",
        table_box,
        [column["header"] for column in columns],
        rows,
        kinds,
        palette_roles(design),
        style,
    )
    note_lines = _note_lines(block, words)
    note = text_element(f"{request['elementId']}-note", "body", note_box, note_lines, note_style)
    facts: list[dict[str, Any]] = [{"kind": "cell", "text": header} for header in table["headers"]]
    for row in rows:
        facts.extend({"kind": "cell", "text": value} for value in row)
    for source in block["sources"]:
        facts.append(
            {
                "kind": "source",
                "text": words["source"].format(item_id=source["itemId"], status=source["status"]),
                "sourceStatus": source["status"],
            }
        )
    if str(block.get("notes") or ""):
        facts.append({"kind": "note", "text": str(block["notes"])})
    return [table, note], facts, overflow, placement
