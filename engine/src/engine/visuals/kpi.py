"""KPI figures as native text: value, unit, caption, period, source and an optional delta."""

from __future__ import annotations

from typing import Any

from engine.visuals.measure import FontBook
from engine.visuals.numbers import delta_lines, display_measured, phrases, require_measured
from engine.visuals.place import (
    grid_cells,
    gutter_of,
    side_by_side,
    split_columns,
    split_rows,
    stacked,
    text_element,
    type_step,
)


def _validate(item: dict[str, Any], index: int) -> None:
    require_measured(item["value"], f"kpi {index} value")
    if item.get("comparison"):
        require_measured(item["comparison"]["base"], f"kpi {index} base")
    if item["periodKnown"] and not str(item.get("period") or ""):
        raise ValueError(f"kpi {index} names a period but does not give it.")
    if not item["periodKnown"] and str(item.get("period") or ""):
        raise ValueError(f"kpi {index} gives a period while marking it unknown.")


def _cells(box: dict[str, int], count: int, gutter: int, variant: str) -> list[dict[str, int]]:
    if variant == "airy":
        return split_rows(box, count, gutter)
    if variant == "balanced" and count > 1:
        columns = 2 if count <= 4 else 3
        return grid_cells(box, count, columns, gutter)
    return split_columns(box, count, gutter)


def _pair(cell: dict[str, int], variant: str, count: int) -> tuple[dict[str, int], dict[str, int]]:
    # One figure has no row to differ by, so the three variants differ by how value and caption sit.
    if variant == "balanced" and count == 1:
        return side_by_side(cell)
    if variant == "airy" and count == 1:
        value, caption = stacked(cell, 0.34)
        return {**value, "cx": max(int(value["cx"] * 0.46), 1)}, caption
    if variant == "airy":
        return side_by_side(cell)
    return stacked(cell)


def _value_text(item: dict[str, Any], words: dict[str, str]) -> str:
    if item["value"]["state"] == "missing":
        return words["missing"]
    literal = display_measured(item["value"], words["missing"])
    unit = str(item.get("unit") or "")
    if unit and unit not in literal:
        return f"{literal} {unit}"
    return literal


def _caption_lines(item: dict[str, Any], words: dict[str, str]) -> list[str]:
    lines = [str(item["caption"])]
    if item["periodKnown"]:
        lines.append(words["period_label"].format(period=item["period"]))
    else:
        lines.append(words["period_unknown"])
    unit = str(item.get("unit") or "")
    if unit:
        lines.append(words["unit_label"].format(unit=unit))
    if item.get("unitAmbiguous"):
        lines.append(f"{words['ambiguous']}: {unit}")
    if item.get("caveat"):
        lines.append(str(item["caveat"]))
    for source in item["sources"]:
        lines.append(words["source"].format(item_id=source["itemId"], status=source["status"]))
    for _kind, text in delta_lines(item, words):
        lines.append(text)
    return lines


def _facts(item: dict[str, Any], words: dict[str, str], value_text: str) -> list[dict[str, Any]]:
    facts: list[dict[str, Any]] = []
    if item["value"]["state"] == "missing":
        facts.append({"kind": "missing", "text": value_text, "unit": str(item.get("unit") or "")})
    else:
        facts.append(
            {
                "kind": "value",
                "text": value_text,
                "unit": str(item.get("unit") or ""),
                "period": str(item.get("period") or ""),
            }
        )
    facts.append({"kind": "note", "text": str(item["caption"])})
    for source in item["sources"]:
        facts.append(
            {
                "kind": "source",
                "text": words["source"].format(item_id=source["itemId"], status=source["status"]),
                "sourceStatus": source["status"],
            }
        )
    for kind, text in delta_lines(item, words):
        facts.append({"kind": "delta" if kind == "delta" else "note", "text": text})
    return facts


def build_kpi(
    request: dict[str, Any], book: FontBook
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return SlideIR text elements and the reading facts. Fit is summarised by the caller."""
    block = request["block"]
    items = block["items"]
    for index, item in enumerate(items, start=1):
        _validate(item, index)
    design = request["designSystem"]
    words = phrases(str(request["language"]))
    value_style = type_step(design, ("kpi-value", "title", "heading", "body"))
    caption_style = type_step(design, ("kpi-caption", "caption", "body"))
    book.note(str(value_style["role"]), str(value_style["font"]))
    book.note(str(caption_style["role"]), str(caption_style["font"]))
    cells = _cells(request["box"], len(items), gutter_of(design), str(request["variant"]))
    elements: list[dict[str, Any]] = []
    facts: list[dict[str, Any]] = []
    prefix = str(request["elementId"])
    for index, (cell, item) in enumerate(zip(cells, items, strict=True), start=1):
        value_box, caption_box = _pair(cell, str(request["variant"]), len(items))
        value_text = _value_text(item, words)
        caption_lines = _caption_lines(item, words)
        elements.append(
            text_element(
                f"{prefix}-value-{index}", "kpi-value", value_box, [value_text], value_style
            )
        )
        elements.append(
            text_element(
                f"{prefix}-caption-{index}",
                "kpi-caption",
                caption_box,
                caption_lines,
                caption_style,
            )
        )
        facts.extend(_facts(item, words, value_text))
    return elements, facts
