"""A contact sheet of structural panels. Fill is by element kind, not by the template palette."""

from __future__ import annotations

from typing import Any
from xml.sax.saxutils import escape

_KIND_FILL = {"chart": "#c5d0dc", "table": "#d5dde6", "text": "#eef2f5"}


def contact_sheet_svg(panels: list[dict[str, Any]]) -> str:
    """Panels side by side. Decoration is omitted, matching the signature."""
    panel_width = 320
    panel_height = 200
    margin = 16
    width = margin + len(panels) * (panel_width + margin)
    height = panel_height + margin * 2 + 28
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" data-contact-sheet="true">',
        f'<rect width="{width}" height="{height}" fill="#f7f4ef"/>',
    ]
    for index, panel in enumerate(panels):
        origin_x = margin + index * (panel_width + margin)
        origin_y = margin
        elements = [
            element
            for element in panel["elements"]
            if element.get("kind") != "decor" and element.get("role") != "decoration"
        ]
        min_x = min(int(element["box"]["x"]) for element in elements)
        min_y = min(int(element["box"]["y"]) for element in elements)
        max_x = max(int(element["box"]["x"]) + int(element["box"]["cx"]) for element in elements)
        max_y = max(int(element["box"]["y"]) + int(element["box"]["cy"]) for element in elements)
        span_x = max(max_x - min_x, 1)
        span_y = max(max_y - min_y, 1)
        title = escape(str(panel.get("title") or panel.get("id") or ""))
        digest = escape(str(panel.get("digest") or ""))
        parts.append(
            f'<g data-panel="{escape(str(panel.get("id") or index))}" data-digest="{digest}">'
        )
        parts.append(
            f'<rect x="{origin_x}" y="{origin_y}" width="{panel_width}" height="{panel_height}" '
            f'fill="#ffffff" stroke="#243140"/>'
        )
        inner_x = origin_x + 8
        inner_y = origin_y + 8
        inner_w = panel_width - 16
        inner_h = panel_height - 16
        for element in elements:
            box = element["box"]
            x = inner_x + (int(box["x"]) - min_x) / span_x * inner_w
            y = inner_y + (int(box["y"]) - min_y) / span_y * inner_h
            w = max(int(box["cx"]) / span_x * inner_w, 1)
            h = max(int(box["cy"]) / span_y * inner_h, 1)
            fill = _KIND_FILL.get(str(element.get("kind")), "#cccccc")
            parts.append(
                f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" '
                f'fill="{fill}" stroke="#243140" data-kind="{escape(str(element.get("kind")))}"/>'
            )
        parts.append(
            f'<text x="{origin_x}" y="{origin_y + panel_height + 18}" '
            f'font-family="sans-serif" font-size="12" fill="#243140">{title}</text>'
        )
        parts.append("</g>")
    parts.append("</svg>")
    return "".join(parts)
