"""Tables and charts of a finished slide, as the SlideIR elements that describe them.

A graphic frame holds either a DrawingML table, which lives in the slide itself, or a chart,
which lives in a chart part next to it. Both are read back only as far as SlideIR can say them:
the cell text and the look a cell states for itself; the chart type, its categories, series and
axis titles. A table style (``a:tableStyleId``) is not expanded, so cells that rely on it read as
inheriting.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import lxml.etree as etree

from engine.parser._deck_style import Colors, fill_child, paint_of

_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
_C = "{http://schemas.openxmlformats.org/drawingml/2006/chart}"

_ANCHOR = {"t": "top", "ctr": "middle", "b": "bottom"}
_ALIGN = {"l": "left", "ctr": "center", "r": "right", "just": "justify", "dist": "justify"}

#: Chart element names SlideIR has a type for.
_CHART_TYPES = {
    "barChart": "bar",
    "bar3DChart": "bar",
    "lineChart": "line",
    "line3DChart": "line",
    "pieChart": "pie",
    "pie3DChart": "pie",
    "doughnutChart": "pie",
    "areaChart": "area",
    "area3DChart": "area",
}

ColorValue = Callable[[str], str]


def _cell_text(cell: Any) -> str:
    paragraphs = []
    for paragraph in cell.findall(f"{_A}txBody/{_A}p"):
        parts = []
        for child in paragraph:
            name = etree.QName(child).localname if isinstance(child.tag, str) else ""
            if name in ("r", "fld"):
                parts.append(child.findtext(f"{_A}t") or "")
            elif name == "br":
                parts.append("\n")
        paragraphs.append("".join(parts))
    return "\n".join(paragraphs)


def _line_visible(line: Any, colors: Colors) -> tuple[str, int] | None:
    """Colour and width of a cell border that is drawn, or None."""
    if line is None:
        return None
    fill = fill_child(line)
    if fill is None:
        return None
    paint = paint_of(fill, colors)
    if paint.kind != "solid" or not paint.color:
        return None
    try:
        width = int(line.get("w", "12700"))
    except ValueError:
        width = 12700
    return paint.color, max(width, 1)


def _cell_style(cell: Any, colors: Colors, color_value: ColorValue) -> dict[str, Any] | None:
    style: dict[str, Any] = {}
    props = cell.find(f"{_A}tcPr")
    if props is not None:
        fill = fill_child(props)
        if fill is not None:
            paint = paint_of(fill, colors)
            if paint.kind == "none":
                style["fill"] = None
            elif paint.kind == "solid" and paint.color:
                style["fill"] = color_value(paint.color)
        anchor = _ANCHOR.get(props.get("anchor", ""))
        if anchor:
            style["verticalAlign"] = anchor
    paragraph = cell.find(f"{_A}txBody/{_A}p")
    if paragraph is not None:
        own = paragraph.find(f"{_A}pPr")
        align = _ALIGN.get(own.get("algn", "")) if own is not None else None
        if align:
            style["align"] = align
        run = paragraph.find(f"{_A}r/{_A}rPr")
        if run is not None:
            for key, attr in (("bold", "b"), ("italic", "i")):
                if run.get(attr) is not None:
                    style[key] = run.get(attr) in ("1", "true")
            if run.get("u") is not None:
                style["underline"] = run.get("u") != "none"
            fill = fill_child(run)
            if fill is not None:
                paint = paint_of(fill, colors)
                if paint.kind == "solid" and paint.color:
                    style["color"] = color_value(paint.color)
    return style or None


def _borders(
    grid: list[list[Any]], colors: Colors, color_value: ColorValue
) -> dict[str, Any] | None:
    """The rules of a table, read off the borders its cells state, or None when none are drawn."""
    seen: list[tuple[str, int]] = []
    horizontal = vertical = outer = False
    last_row, last_col = len(grid) - 1, max(len(row) for row in grid) - 1
    for r, row in enumerate(grid):
        for c, cell in enumerate(row):
            props = cell.find(f"{_A}tcPr")
            if props is None:
                continue
            for tag in ("lnL", "lnR", "lnT", "lnB"):
                drawn = _line_visible(props.find(f"{_A}{tag}"), colors)
                if drawn is None:
                    continue
                seen.append(drawn)
                edge = (
                    (tag == "lnL" and c == 0)
                    or (tag == "lnR" and c == last_col)
                    or (tag == "lnT" and r == 0)
                    or (tag == "lnB" and r == last_row)
                )
                if edge:
                    outer = True
                elif tag in ("lnT", "lnB"):
                    horizontal = True
                else:
                    vertical = True
    if not seen:
        return None
    color, width = seen[0]
    return {
        "color": color_value(color),
        "widthEmu": width,
        "horizontal": horizontal,
        "vertical": vertical,
        "outer": outer,
    }


def table_fields(table: Any, colors: Colors, color_value: ColorValue) -> dict[str, Any] | None:
    """The table-specific fields of a SlideIR table element, or None for an empty table."""
    rows = table.findall(f"{_A}tr")
    grid = [row.findall(f"{_A}tc") for row in rows]
    if not grid or not grid[0]:
        return None
    columns = len(grid[0])
    texts = [[_cell_text(cell) for cell in row][:columns] for row in grid]
    texts = [row + [""] * (columns - len(row)) for row in texts]
    body = texts[1:] or [[""] * columns]
    fields: dict[str, Any] = {"headers": texts[0], "rows": body}

    widths = []
    for col in table.findall(f"{_A}tblGrid/{_A}gridCol"):
        try:
            widths.append(int(col.get("w", "0")))
        except ValueError:
            widths.append(0)
    if len(widths) == columns and all(w > 0 for w in widths):
        fields["columnWidths"] = widths
    heights = []
    for row in rows:
        try:
            heights.append(int(row.get("h", "0")))
        except ValueError:
            heights.append(0)
    if len(rows) > 1 and all(h > 0 for h in heights):
        fields["rowHeights"] = heights

    props = table.find(f"{_A}tblPr")
    if props is not None:
        fields["headerRow"] = props.get("firstRow") in ("1", "true")
        fields["bandedRows"] = props.get("bandRow") in ("1", "true")

    styles = [[_cell_style(cell, colors, color_value) for cell in row] for row in grid]
    if any(style for row in styles for style in row):
        fields["cellStyles"] = styles
    borders = _borders(grid, colors, color_value)
    if borders is not None:
        fields["borders"] = borders
    return fields


def _cached(ref: Any) -> list[tuple[int, str]]:
    """Cached points of a chart reference or literal, as (index, text)."""
    if ref is None:
        return []
    points = []
    for point in ref.iter(f"{_C}pt"):
        try:
            index = int(point.get("idx", "0"))
        except ValueError:
            continue
        points.append((index, point.findtext(f"{_C}v") or ""))
    return points


def _title(element: Any) -> str:
    if element is None:
        return ""
    title = element.find(f"{_C}title")
    if title is None:
        return ""
    return "".join(t.text or "" for t in title.iter(f"{_A}t")).strip()


def chart_fields(blob: bytes) -> tuple[dict[str, Any] | None, str]:
    """The chart-specific fields of a SlideIR chart element, or None and the reason why not."""
    try:
        root = etree.fromstring(blob)
    except etree.XMLSyntaxError as error:
        return None, f"chart part is not well-formed XML: {error}"
    plot = root.find(f"{_C}chart/{_C}plotArea")
    if plot is None:
        return None, "chart has no plot area"
    for element in plot:
        name = etree.QName(element).localname if isinstance(element.tag, str) else ""
        kind = _CHART_TYPES.get(name)
        if kind is None:
            continue
        if kind == "bar":
            direction = element.find(f"{_C}barDir")
            kind = "column" if direction is None or direction.get("val") == "col" else "bar"
        series_elements = element.findall(f"{_C}ser")
        categories: list[str] = []
        series: list[dict[str, Any]] = []
        for number, ser in enumerate(series_elements, start=1):
            values_points = _cached(ser.find(f"{_C}val"))
            if not values_points:
                continue
            length = max(i for i, _ in values_points) + 1
            values = [0.0] * length
            for index, text in values_points:
                try:
                    values[index] = float(text)
                except ValueError:
                    values[index] = 0.0
            name_points = _cached(ser.find(f"{_C}tx"))
            series.append(
                {"name": name_points[0][1] if name_points else f"{number}", "values": values}
            )
            if not categories:
                cat_points = _cached(ser.find(f"{_C}cat"))
                if cat_points:
                    labels = [""] * (max(i for i, _ in cat_points) + 1)
                    for index, text in cat_points:
                        labels[index] = text
                    categories = labels
        if not series:
            return None, f"{name} has no cached values"
        if not categories:
            categories = [str(i + 1) for i in range(max(len(s["values"]) for s in series))]
        for entry in series:
            entry["name"] = entry["name"] or "—"
        return {
            "chartType": kind,
            "categories": categories,
            "series": series,
            "xTitle": _title(plot.find(f"{_C}catAx")),
            "yTitle": _title(plot.find(f"{_C}valAx")),
        }, ""
    return None, "chart type has no SlideIR counterpart"
