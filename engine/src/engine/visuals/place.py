"""Boxes inside the region the caller already measured. No template ids, no palette literals."""

from __future__ import annotations

import math
from typing import Any

from engine.visuals.measure import text_overflow


def type_step(design: dict[str, Any], roles: tuple[str, ...]) -> dict[str, Any]:
    """The first requested role the template's own scale actually defines."""
    scale = {item["role"]: item for item in design["typeScale"]}
    for role in roles:
        if role in scale:
            return scale[role]
    return design["typeScale"][0]


def gutter_of(design: dict[str, Any]) -> int:
    grid = design.get("grid") or {}
    return int(grid.get("gutter") or 0)


def split_columns(box: dict[str, int], count: int, gutter: int) -> list[dict[str, int]]:
    count = max(count, 1)
    gap = gutter if count > 1 else 0
    width = max((int(box["cx"]) - gap * (count - 1)) // count, 1)
    return [
        {
            "x": int(box["x"]) + index * (width + gap),
            "y": int(box["y"]),
            "cx": width,
            "cy": int(box["cy"]),
        }
        for index in range(count)
    ]


def split_rows(box: dict[str, int], count: int, gutter: int) -> list[dict[str, int]]:
    count = max(count, 1)
    gap = gutter if count > 1 else 0
    height = max((int(box["cy"]) - gap * (count - 1)) // count, 1)
    return [
        {
            "x": int(box["x"]),
            "y": int(box["y"]) + index * (height + gap),
            "cx": int(box["cx"]),
            "cy": height,
        }
        for index in range(count)
    ]


def grid_cells(box: dict[str, int], count: int, columns: int, gutter: int) -> list[dict[str, int]]:
    columns = max(1, min(columns, count))
    rows = math.ceil(count / columns)
    row_boxes = split_rows(box, rows, gutter)
    cells: list[dict[str, int]] = []
    for index in range(count):
        row, column = divmod(index, columns)
        cells.append(split_columns(row_boxes[row], columns, gutter)[column])
    return cells


def side_by_side(
    cell: dict[str, int], left_share: float = 0.38
) -> tuple[dict[str, int], dict[str, int]]:
    left_width = max(int(int(cell["cx"]) * left_share), 1)
    value = {**cell, "cx": left_width}
    caption = {
        **cell,
        "x": int(cell["x"]) + left_width,
        "cx": max(int(cell["cx"]) - left_width, 1),
    }
    return value, caption


def stacked(cell: dict[str, int], top_share: float = 0.34) -> tuple[dict[str, int], dict[str, int]]:
    value_height = max(int(int(cell["cy"]) * top_share), 1)
    value = {**cell, "cy": value_height}
    caption = {
        **cell,
        "y": int(cell["y"]) + value_height,
        "cy": max(int(cell["cy"]) - value_height, 1),
    }
    return value, caption


def horizontal_split(
    box: dict[str, int], gutter: int, top_share: float
) -> tuple[dict[str, int], dict[str, int]]:
    top_height = max(int(int(box["cy"]) * top_share) - gutter // 2, 1)
    top = {**box, "cy": top_height}
    bottom_y = int(box["y"]) + top_height + gutter
    bottom = {
        **box,
        "y": bottom_y,
        "cy": max(int(box["y"]) + int(box["cy"]) - bottom_y, 1),
    }
    return top, bottom


def vertical_split(
    box: dict[str, int], gutter: int, left_share: float
) -> tuple[dict[str, int], dict[str, int]]:
    left_width = max(int(int(box["cx"]) * left_share) - gutter // 2, 1)
    left = {**box, "cx": left_width}
    right_x = int(box["x"]) + left_width + gutter
    right = {
        **box,
        "x": right_x,
        "cx": max(int(box["x"]) + int(box["cx"]) - right_x, 1),
    }
    return left, right


def carve_end(box: dict[str, int], share: float) -> tuple[dict[str, int], dict[str, int]]:
    """Return the main box and a band at its bottom."""
    note_height = max(int(int(box["cy"]) * share), 1)
    main_height = max(int(box["cy"]) - note_height, 1)
    main = {**box, "cy": main_height}
    note = {**box, "y": int(box["y"]) + main_height, "cy": max(int(box["cy"]) - main_height, 1)}
    return main, note


def paragraph(text: str, style: dict[str, Any], align: str | None = None) -> dict[str, Any]:
    item: dict[str, Any] = {
        "level": 0,
        "lineSpacing": float(style.get("lineSpacing") or 1),
        "runs": [
            {
                "text": text,
                "font": style["font"],
                "sizePt": float(style["sizePt"]),
                "bold": bool(style.get("bold")),
                "italic": bool(style.get("italic")),
                "color": "",
            }
        ],
    }
    if align:
        item["align"] = align
    return item


def text_element(
    element_id: str,
    role: str,
    box: dict[str, int],
    lines: list[str],
    style: dict[str, Any],
    align: str | None = None,
) -> dict[str, Any]:
    return {
        "kind": "text",
        "elementId": element_id,
        "role": role,
        "box": {key: int(box[key]) for key in ("x", "y", "cx", "cy")},
        "sourceShapeId": None,
        "paragraphs": [paragraph(line, style, align) for line in lines] or [paragraph("", style)],
        "overflow": text_overflow(lines, box, style),
    }


def palette_roles(design: dict[str, Any]) -> set[str]:
    return {entry["role"] for entry in design.get("palette") or []}
