"""Boxes, colours and type lookups the checks share.

Everything here works on the JSON form of the contracts: the API validates a request against the
generated models and hands the checks plain dictionaries, so the rules read the same fields the
TypeScript side writes.
"""

import math
import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from typing import Any

EMU_PER_PT = 12_700

#: Default text insets of an OOXML body, in EMU: 0.1 inch left and right, 0.05 inch top and bottom.
DEFAULT_INSETS = {"l": 91_440, "t": 45_720, "r": 91_440, "b": 45_720}

#: Roles the template places around the content rather than content itself.
FURNITURE_ROLES = frozenset({"logo", "footer", "page-number", "decoration"})

#: How the roles of slide elements map onto the roles of the type scale.
_TYPE_ROLE = {
    "title": "title",
    "subtitle": "subtitle",
    "body": "body",
    "bullet-list": "bullet",
    "kpi-value": "kpi-value",
    "kpi-caption": "kpi-caption",
    "quote": "quote",
    "footer": "footer",
    "page-number": "footer",
    "table": "body",
}

_HEX = re.compile(r"^[0-9a-fA-F]{6}$")


@dataclass(frozen=True, slots=True)
class Rect:
    """An axis-aligned rectangle in EMU."""

    x: int
    y: int
    cx: int
    cy: int

    @classmethod
    def of(cls, box: dict[str, Any]) -> "Rect":
        return cls(int(box["x"]), int(box["y"]), int(box["cx"]), int(box["cy"]))

    @property
    def right(self) -> int:
        return self.x + self.cx

    @property
    def bottom(self) -> int:
        return self.y + self.cy

    @property
    def area(self) -> int:
        return max(self.cx, 0) * max(self.cy, 0)

    def intersection(self, other: "Rect") -> "Rect | None":
        x, y = max(self.x, other.x), max(self.y, other.y)
        right, bottom = min(self.right, other.right), min(self.bottom, other.bottom)
        if right <= x or bottom <= y:
            return None
        return Rect(x, y, right - x, bottom - y)

    def contains_point(self, px: float, py: float) -> bool:
        return self.x <= px <= self.right and self.y <= py <= self.bottom

    def as_box(self) -> dict[str, int]:
        return {"x": self.x, "y": self.y, "cx": self.cx, "cy": self.cy}


#: Where the import takes an element from: a picture drawn by the layout or the master is the
#: template's own artwork, and its id says so (`layout-12`, `master-3`; a slide's is `slide-7`).
_TEMPLATE_PARTS = ("layout-", "master-")


def is_template_art(element: dict[str, Any]) -> bool:
    """A picture the template draws behind the slide: part of its design, not of the deck."""
    return element["kind"] == "image" and str(element["elementId"]).startswith(_TEMPLATE_PARTS)


def is_content(element: dict[str, Any]) -> bool:
    """Whether an element carries content of the deck rather than template furniture."""
    if element["role"] in FURNITURE_ROLES or is_template_art(element):
        return False
    return element["kind"] != "decor" or bool(element.get("paragraphs"))


def paragraphs_of(element: dict[str, Any]) -> list[dict[str, Any]]:
    """Paragraphs of a text element or of the text inside a shape."""
    return list(element.get("paragraphs") or [])


def paragraph_text(paragraph: dict[str, Any]) -> str:
    return "".join(run.get("text", "") for run in paragraph.get("runs", []))


def element_texts(element: dict[str, Any]) -> Iterator[str]:
    """Every piece of text an element shows: paragraphs, table cells, chart titles."""
    for paragraph in paragraphs_of(element):
        yield paragraph_text(paragraph)
    if element["kind"] == "table":
        yield from element.get("headers", [])
        for row in element.get("rows", []):
            yield from row
    if element["kind"] == "chart":
        yield element.get("xTitle", "")
        yield element.get("yTitle", "")
        yield from element.get("categories", [])
        for series in element.get("series", []):
            yield series.get("name", "")


def share_groups(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return bool(set(a.get("groupIds") or ()) & set(b.get("groupIds") or ()))


class Template:
    """The design system of the template, with the lookups the checks keep asking for."""

    def __init__(self, design_system: dict[str, Any]) -> None:
        self.ds = design_system
        self.grid: dict[str, Any] = design_system["grid"]
        self.palette: dict[str, str] = {
            entry["role"]: entry["hex"].upper() for entry in design_system["palette"]
        }
        self.scale: dict[str, dict[str, Any]] = {
            style["role"]: style for style in design_system["typeScale"]
        }
        self.sizes: list[float] = sorted({float(s["sizePt"]) for s in design_system["typeScale"]})
        fonts: set[str] = set()
        for family in design_system["typeFamilies"]:
            fonts.update({family["font"], family["declared"]})
        fonts.update(style["font"] for style in design_system["typeScale"])
        self.fonts = {font.casefold() for font in fonts if font}
        colours = set(self.palette.values())
        for surface in design_system["surfaces"]:
            colours.update({surface["background"].upper(), surface["text"].upper()})
            if surface.get("accent"):
                colours.add(surface["accent"].upper())
        self.colours = colours

    def style_for(self, element_role: str) -> dict[str, Any] | None:
        role = _TYPE_ROLE.get(element_role, "body")
        return self.scale.get(role) or self.scale.get("body")

    def default_font(self, element_role: str) -> str:
        style = self.style_for(element_role)
        if style:
            return str(style["font"])
        return str(self.ds["typeFamilies"][0]["font"])

    def default_size(self, element_role: str) -> float:
        style = self.style_for(element_role)
        return float(style["sizePt"]) if style else 18.0

    def default_line_spacing(self, element_role: str) -> float:
        style = self.style_for(element_role)
        return float(style["lineSpacing"]) if style else 1.0

    def resolve(self, value: str | None) -> str | None:
        """Hex of a colour value: a palette role or a literal. None when it cannot be resolved."""
        if not value:
            return None
        if _HEX.match(value):
            return value.upper()
        return self.palette.get(value)

    def default_text_colour(self, element_role: str) -> str | None:
        style = self.style_for(element_role)
        role = style["colorRole"] if style else "text"
        return self.palette.get(role) or self.palette.get("text")

    def default_background(self) -> str | None:
        if "background" in self.palette:
            return self.palette["background"]
        surfaces = self.ds["surfaces"]
        light = [s for s in surfaces if s["tone"] == "light"]
        return (light or surfaces)[0]["background"].upper() if surfaces else None

    def safe_area(self, min_margin_emu: int) -> Rect:
        """Content area inside the margins. A margin the grid could not measure uses the floor."""
        grid = self.grid

        def margin(key: str) -> int:
            value = int(grid[key])
            return value if value > 0 else min_margin_emu

        left, right = margin("marginLeft"), margin("marginRight")
        top, bottom = margin("marginTop"), margin("marginBottom")
        return Rect(
            left, top, int(grid["slideCx"]) - left - right, int(grid["slideCy"]) - top - bottom
        )

    def column_guides(self) -> tuple[list[int], list[int]]:
        """Left and right edges of the grid columns, in EMU."""
        grid = self.grid
        left = int(grid["marginLeft"])
        width = int(grid["slideCx"]) - left - int(grid["marginRight"])
        columns = max(int(grid["columns"]), 1)
        gutter = int(grid["gutter"])
        column = (width - gutter * (columns - 1)) / columns
        starts = [round(left + i * (column + gutter)) for i in range(columns)]
        ends = [round(start + column) for start in starts]
        return starts, ends


def hex_distance(a: str, b: str) -> int:
    """Largest difference between two colours in any channel, from 0 to 255."""
    return max(abs(int(a[i : i + 2], 16) - int(b[i : i + 2], 16)) for i in (0, 2, 4))


def nearest(value: str, candidates: Iterable[str]) -> str | None:
    pool = list(candidates)
    return min(pool, key=lambda c: hex_distance(value, c)) if pool else None


def _linear(channel: int) -> float:
    c = channel / 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def luminance(hex_colour: str) -> float:
    r, g, b = (int(hex_colour[i : i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * _linear(r) + 0.7152 * _linear(g) + 0.0722 * _linear(b)


def contrast_ratio(a: str, b: str) -> float:
    """WCAG 2 contrast ratio between two colours, from 1 to 21."""
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def insets_of(element: dict[str, Any]) -> dict[str, int]:
    return dict(element.get("textInsets") or DEFAULT_INSETS)


def text_height(
    element: dict[str, Any],
    template: Template,
    size_override: float | None,
    char_width_em: float,
    line_height: float,
) -> tuple[int, int]:
    """Estimated height of an element's text and the lines it takes, set at its sizes.

    A paragraph wraps at the average character width of its largest run. The estimate errs a
    little towards more lines, which is the safe side for an overflow check.
    """
    insets = insets_of(element)
    width = max(int(element["box"]["cx"]) - insets["l"] - insets["r"], 1)
    total, lines_total = insets["t"] + insets["b"], 0
    for paragraph in paragraphs_of(element):
        sizes = [
            float(run["sizePt"]) for run in paragraph.get("runs", []) if run.get("sizePt")
        ] or [template.default_size(element["role"])]
        size = size_override or max(sizes)
        size_emu = size * EMU_PER_PT
        indent = int(paragraph.get("level", 0)) * size_emu * 1.5
        per_line = max(int((width - indent) / (char_width_em * size_emu)), 1)
        lines = max(_wrapped_lines(paragraph_text(paragraph), per_line), 1)
        spacing = paragraph.get("lineSpacing") or template.default_line_spacing(element["role"])
        total += round(lines * size_emu * line_height * float(spacing))
        lines_total += lines
    return total, lines_total


def widest_word(
    element: dict[str, Any],
    template: Template,
    size_override: float | None,
    char_width_em: float,
    min_chars: int,
) -> tuple[str, int, int] | None:
    """The word of an element that is wider than its box, with the width it needs and has.

    A line wraps only between words, so a word wider than the box is torn wherever the box ends.
    The width is estimated as `char_width_em` of the size per character, like the overflow check
    does; words shorter than `min_chars` are left out, a box that narrow is a layout of its own.
    Returns the word that overshoots the most, or None when every word fits.
    """
    insets = insets_of(element)
    width = max(int(element["box"]["cx"]) - insets["l"] - insets["r"], 1)
    worst: tuple[str, int, int] | None = None
    for paragraph in paragraphs_of(element):
        sizes = [
            float(run["sizePt"]) for run in paragraph.get("runs", []) if run.get("sizePt")
        ] or [template.default_size(element["role"])]
        size_emu = (size_override or max(sizes)) * EMU_PER_PT
        available = max(width - int(paragraph.get("level", 0)) * size_emu * 1.5, 1)
        for word in paragraph_text(paragraph).split():
            bare = word.strip(".,;:!?«»\"'()[]")
            needed = int(len(bare) * char_width_em * size_emu)
            torn = len(bare) >= min_chars and needed > available
            if torn and (worst is None or needed - available > worst[1] - worst[2]):
                worst = (bare, needed, int(available))
    return worst


def _wrapped_lines(text: str, per_line: int) -> int:
    lines = 0
    for chunk in text.split("\n"):
        current, count = 0, 1
        for word in chunk.split():
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
        lines += count
    return lines


def fraction_covered(rects: list[Rect], slide: Rect, cells: int = 160) -> float:
    """Share of the slide covered by the union of rectangles, sampled on a grid."""
    if not rects:
        return 0.0
    rows = max(round(cells * slide.cy / max(slide.cx, 1)), 1)
    step_x, step_y = slide.cx / cells, slide.cy / rows
    covered = 0
    for j in range(rows):
        py = slide.y + (j + 0.5) * step_y
        for i in range(cells):
            px = slide.x + (i + 0.5) * step_x
            if any(rect.contains_point(px, py) for rect in rects):
                covered += 1
    return covered / (cells * rows)


def words(text: str) -> int:
    return len(text.split())


def distortion(box: dict[str, Any], width: float, height: float) -> float:
    """How far the box stretches a picture of the given size, as a share: 0 keeps it true."""
    if width <= 0 or height <= 0 or box["cy"] <= 0:
        return 0.0
    return abs(math.log((box["cx"] / box["cy"]) / (width / height)))
