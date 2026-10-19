"""Structural signatures of a visual.

Colour, typeface, element ids, decoration and a translation of the whole group are ignored.
A different arrangement of the same facts is a different signature. One case does not calibrate
a universal distance; callers compare equality of these digests.
"""

from __future__ import annotations

import hashlib
from typing import Any

_COLUMNS = 6
_ROWS = 6


def _content(elements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    kept = [
        element
        for element in elements
        if element.get("role") != "decoration" and element.get("kind") != "decor"
    ]
    return kept or elements


def _cell(box: dict[str, Any], bounds: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    min_x, min_y, width, height = bounds
    width = max(width, 1)
    height = max(height, 1)
    left = (int(box["x"]) - min_x) / width
    top = (int(box["y"]) - min_y) / height
    right = (int(box["x"]) + int(box["cx"]) - min_x) / width
    bottom = (int(box["y"]) + int(box["cy"]) - min_y) / height
    column = min(_COLUMNS - 1, max(0, int(left * _COLUMNS)))
    row = min(_ROWS - 1, max(0, int(top * _ROWS)))
    column_end = min(_COLUMNS, max(column + 1, int(right * _COLUMNS + 1e-9)))
    row_end = min(_ROWS, max(row + 1, int(bottom * _ROWS + 1e-9)))
    return column, row, column_end - column, row_end - row


def _extra(element: dict[str, Any]) -> str:
    if element.get("kind") == "chart":
        positions = element.get("positions") or []
        axis = "xy" if positions else "category"
        missing = sum(
            1 for series in element["series"] for value in series["values"] if value is None
        )
        return (
            f"|{element['chartType']}|s{len(element['series'])}|c{len(element['categories'])}"
            f"|{axis}|m{missing}"
        )
    if element.get("kind") == "table":
        styles = element.get("cellStyles") or []
        body = styles[1] if len(styles) > 1 else []
        marks: list[str] = []
        for index in range(len(element["headers"])):
            own = body[index] if index < len(body) and body[index] else {}
            align = str(own.get("align") or "left")
            marks.append(align[0].upper())
        return f"|{len(element['rows'])}x{len(element['headers'])}|{''.join(marks)}"
    return ""


def structural_signature(elements: list[dict[str, Any]]) -> dict[str, Any]:
    """Digest of topology, chart type and table shape. Not of colour, font or copy."""
    content = _content(elements)
    min_x = min(int(element["box"]["x"]) for element in content)
    min_y = min(int(element["box"]["y"]) for element in content)
    max_x = max(int(element["box"]["x"]) + int(element["box"]["cx"]) for element in content)
    max_y = max(int(element["box"]["y"]) + int(element["box"]["cy"]) for element in content)
    bounds = (min_x, min_y, max_x - min_x, max_y - min_y)
    tokens: list[str] = []
    for element in content:
        column, row, column_span, row_span = _cell(element["box"], bounds)
        tokens.append(
            f"{element['kind']}:{element['role']}@{column},{row},{column_span}x{row_span}"
            f"{_extra(element)}"
        )
    # Array order is irrelevant for disjoint objects, but overlapping content
    # retains its paint relationship: an image above text is a different result.
    layering: list[str] = []
    for first, behind in enumerate(content):
        a = behind["box"]
        for second in range(first + 1, len(content)):
            b = content[second]["box"]
            if min(a["x"] + a["cx"], b["x"] + b["cx"]) > max(a["x"], b["x"]) and min(
                a["y"] + a["cy"], b["y"] + b["cy"]
            ) > max(a["y"], b["y"]):
                layering.append(f"paint:{tokens[first]}<{tokens[second]}")
    tokens.extend(layering)
    tokens.sort()
    digest = hashlib.sha256("\n".join(tokens).encode()).hexdigest()
    return {"digest": digest, "tokens": tokens}


def compare_subjects(subjects: list[dict[str, Any]]) -> dict[str, Any]:
    """Three variants must differ. A control passes only when it is not a new design."""
    signatures = []
    digests: dict[str, str] = {}
    for subject in subjects:
        signature = structural_signature(subject["elements"])
        digests[subject["id"]] = signature["digest"]
        signatures.append({"id": subject["id"], "digest": signature["digest"]})
    variants = [subject for subject in subjects if subject["role"] == "variant"]
    variant_digests = [digests[subject["id"]] for subject in variants]
    variants_distinct = len(variant_digests) >= 2 and len(set(variant_digests)) == len(
        variant_digests
    )
    controls = []
    for subject in subjects:
        if subject["role"] != "control":
            continue
        like = str(subject.get("like") or "")
        collapsed = bool(like) and like in digests and digests[subject["id"]] == digests[like]
        controls.append({"id": subject["id"], "like": like, "collapsed": collapsed})
    accepted = (
        len(variants) >= 3 and variants_distinct and all(item["collapsed"] for item in controls)
    )
    return {
        "schemaVersion": 1,
        "signatures": signatures,
        "variantsDistinct": variants_distinct,
        "controls": controls,
        "accepted": accepted,
    }
