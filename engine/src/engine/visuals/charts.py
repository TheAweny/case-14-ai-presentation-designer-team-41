"""Choose a native chart the data can support, and keep the source table beside it."""

from __future__ import annotations

from typing import Any

from engine.visuals.measure import FontBook
from engine.visuals.numbers import display_measured, phrases, require_measured
from engine.visuals.place import (
    gutter_of,
    horizontal_split,
    palette_roles,
    split_rows,
    text_element,
    type_step,
    vertical_split,
)
from engine.visuals.tables import make_table

_Chart = tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    dict[str, Any],
    list[str],
    str,
    dict[str, int] | None,
]


def _validate(block: dict[str, Any]) -> None:
    count = len(block["categories"])
    seen_position = [item.get("position") is not None for item in block["categories"]]
    if any(seen_position) and not all(seen_position):
        raise ValueError("Either every category has a position, or none do.")
    if all(seen_position) and count >= 2:
        positions = [float(item["position"]) for item in block["categories"]]
        gaps = [positions[index + 1] - positions[index] for index in range(count - 1)]
        if any(gap <= 0 for gap in gaps):
            raise ValueError("Category positions must increase.")
    for series in block["series"]:
        if len(series["values"]) != count:
            raise ValueError(f"Series {series['name']} must have one value per category.")
        for value in series["values"]:
            require_measured(value, series["name"])


def _positions(categories: list[dict[str, Any]]) -> list[float] | None:
    if any(item.get("position") is None for item in categories):
        return None
    if len(categories) < 3:
        return None
    positions = [float(item["position"]) for item in categories]
    gaps = [positions[index + 1] - positions[index] for index in range(len(positions) - 1)]
    if max(gaps) - min(gaps) <= 1e-9:
        return None
    return positions


def _values(series: dict[str, Any]) -> list[float | None]:
    return [
        None if item["state"] == "missing" else float(item["value"]) for item in series["values"]
    ]


def _negative(series_list: list[dict[str, Any]]) -> bool:
    return any(
        value is not None and value < 0 for series in series_list for value in _values(series)
    )


def _missing(series_list: list[dict[str, Any]]) -> bool:
    return any(item["state"] == "missing" for series in series_list for item in series["values"])


def _pie_ok(block: dict[str, Any], series_list: list[dict[str, Any]]) -> bool:
    if block["intent"] != "part-of-whole" or len(series_list) != 1:
        return False
    if _negative(series_list) or _missing(series_list):
        return False
    values = [value for value in _values(series_list[0]) if value is not None]
    return bool(values) and sum(values) > 0


def _suitable(block: dict[str, Any], series_list: list[dict[str, Any]], unequal: bool) -> set[str]:
    one = len(block["categories"]) == 1
    time = block["intent"] == "time-series" or unequal
    suitable: set[str] = set()
    if time and not one:
        suitable.add("line")
        if not _negative(series_list) and not _missing(series_list):
            suitable.add("area")
    if not time or one:
        suitable.update({"column", "bar"})
    if _pie_ok(block, series_list):
        suitable.add("pie")
    return suitable


def _choose(block: dict[str, Any], variant: str, suitable: set[str]) -> tuple[str, bool, str]:
    requested = block.get("requestedType")
    long_labels = any(len(str(item["label"])) > 18 for item in block["categories"])
    pie_rejected = requested == "pie" and "pie" not in suitable
    if requested in suitable:
        return str(requested), False, f"Requested {requested} matches the data."
    if "line" in suitable:
        reason = (
            "Pie cannot show this series. A line is used."
            if pie_rejected
            else "A time series uses a line."
        )
        return "line", pie_rejected, reason
    chosen = "bar" if variant == "dense" or long_labels else "column"
    if len(block["categories"]) == 1:
        reason = "A single observation is a column or a bar, not a line or a pie."
    elif pie_rejected:
        reason = "Pie needs one non-negative series with no gaps and a part-of-whole intent."
    else:
        reason = "Categories are compared without sharing an axis across unrelated shapes."
    return chosen, pie_rejected, reason


def _axis_title(stated: str, unit: str) -> str:
    if unit and unit not in stated:
        return f"{stated}, {unit}".strip(", ")
    return stated


def _chart_element(
    element_id: str,
    box: dict[str, int],
    chart_type: str,
    categories: list[dict[str, Any]],
    series_list: list[dict[str, Any]],
    x_title: str,
    y_title: str,
    positions: list[float] | None,
) -> dict[str, Any]:
    series = []
    for item in series_list:
        entry: dict[str, Any] = {"name": item["name"], "values": _values(item)}
        if item.get("unit"):
            entry["unit"] = item["unit"]
        series.append(entry)
    element: dict[str, Any] = {
        "kind": "chart",
        "elementId": element_id,
        "role": "chart",
        "box": {key: int(box[key]) for key in ("x", "y", "cx", "cy")},
        "sourceShapeId": None,
        "chartType": chart_type,
        "categories": [str(item["label"]) for item in categories],
        "series": series,
        "xTitle": x_title,
        "yTitle": y_title,
    }
    if positions and chart_type == "line":
        element["positions"] = positions
    return element


def _regions(
    box: dict[str, int], variant: str, gutter: int
) -> tuple[dict[str, int], dict[str, int], str]:
    if variant == "dense":
        chart, table = vertical_split(box, gutter, 0.58)
        return chart, table, "chart-beside-table"
    if variant == "airy":
        table, chart = horizontal_split(box, gutter, 0.4)
        return chart, table, "table-above-chart"
    chart, table = horizontal_split(box, gutter, 0.62)
    return chart, table, "chart-above-table"


def _groups(series_list: list[dict[str, Any]]) -> list[tuple[str, list[dict[str, Any]]]]:
    order: list[str] = []
    grouped: dict[str, list[dict[str, Any]]] = {}
    for series in series_list:
        unit = str(series.get("unit") or "")
        if unit not in grouped:
            order.append(unit)
            grouped[unit] = []
        grouped[unit].append(series)
    return [(unit, grouped[unit]) for unit in order]


def build_chart(request: dict[str, Any], book: FontBook) -> _Chart:
    """Charts plus the source table. Mixed units become one chart per unit, never one axis."""
    block = request["block"]
    _validate(block)
    design = request["designSystem"]
    words = phrases(str(request["language"]))
    positions = _positions(block["categories"])
    groups = _groups(block["series"])
    variant = str(request["variant"])
    used: list[str] = []
    reasons: list[str] = []
    pie_rejected = False
    chart_box, table_box, placement = _regions(request["box"], variant, gutter_of(design))
    note_style = type_step(design, ("caption", "footer", "body"))
    book.note(str(note_style["role"]), str(note_style["font"]))
    table_style = type_step(
        design, ("caption", "footer", "body") if variant == "dense" else ("body", "caption")
    )
    book.note(str(table_style["role"]), str(table_style["font"]))
    note_height = max(int(table_box["cy"] * 0.34), 1)
    grid_box = {**table_box, "cy": max(int(table_box["cy"]) - note_height, 1)}
    note_box = {
        **table_box,
        "y": int(grid_box["y"]) + int(grid_box["cy"]),
        "cy": max(
            int(table_box["y"]) + int(table_box["cy"]) - int(grid_box["y"]) - int(grid_box["cy"]), 1
        ),
    }
    chart_boxes = split_rows(chart_box, len(groups), gutter_of(design))
    elements: list[dict[str, Any]] = []
    for index, ((unit, series_list), box) in enumerate(
        zip(groups, chart_boxes, strict=True), start=1
    ):
        suitable = _suitable(block, series_list, positions is not None)
        chart_type, rejected, reason = _choose(block, variant, suitable)
        pie_rejected = pie_rejected or rejected
        used.append(chart_type)
        reasons.append(reason)
        elements.append(
            _chart_element(
                f"{request['elementId']}-chart-{index}",
                box,
                chart_type,
                block["categories"],
                series_list,
                str(block.get("xTitle") or ""),
                _axis_title(str(block.get("yTitle") or ""), unit),
                positions,
            )
        )
    headers = [words["category"], *[series["name"] for series in block["series"]]]
    kinds = ["text", *["number" for _ in block["series"]]]
    rows = []
    for index, category in enumerate(block["categories"]):
        rows.append(
            [
                str(category["label"]),
                *[
                    display_measured(series["values"][index], words["missing"])
                    for series in block["series"]
                ],
            ]
        )
    table, overflow = make_table(
        f"{request['elementId']}-data",
        grid_box,
        headers,
        rows,
        kinds,
        palette_roles(design),
        table_style,
    )
    note_lines = []
    if block.get("caveat"):
        note_lines.append(str(block["caveat"]))
    for source in block["sources"]:
        note_lines.append(words["source"].format(item_id=source["itemId"], status=source["status"]))
        note_lines.append(str(source["quote"]))
    note = text_element(
        f"{request['elementId']}-note", "body", note_box, note_lines or [words["notes"]], note_style
    )
    elements.extend([table, note])
    facts: list[dict[str, Any]] = []
    for category in block["categories"]:
        facts.append({"kind": "category", "text": str(category["label"])})
    for series in block["series"]:
        for index, category in enumerate(block["categories"]):
            measured = series["values"][index]
            kind = "missing" if measured["state"] == "missing" else "value"
            facts.append(
                {
                    "kind": kind,
                    "text": display_measured(measured, words["missing"]),
                    "unit": str(series.get("unit") or ""),
                    "period": str(category["label"]),
                }
            )
    for source in block["sources"]:
        facts.append(
            {
                "kind": "source",
                "text": words["source"].format(item_id=source["itemId"], status=source["status"]),
                "sourceStatus": source["status"],
            }
        )
    native = "xy" if positions and "line" in used else "category"
    decision = {
        "requested": block.get("requestedType"),
        "used": used,
        "reason": " ".join(dict.fromkeys(reasons)),
        "pieRejected": pie_rejected,
        "nativeAxis": native,
        "splitByUnit": len(groups) > 1,
    }
    limitations: list[str] = []
    if native == "xy":
        limitations.append(
            "Unequal intervals are a native XY line. A category chart would space them evenly."
        )
    if len(groups) > 1:
        limitations.append(
            "Series with different units are separate charts. They do not share an axis."
        )
    if pie_rejected:
        limitations.append(decision["reason"])
    return elements, facts, decision, limitations, placement, overflow
