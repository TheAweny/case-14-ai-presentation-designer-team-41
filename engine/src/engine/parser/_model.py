"""Typed intermediate representation of a parsed template.

These dataclasses are internal to the parser. The public entry point flattens them into a plain
dictionary, because the shared contracts are generated from Zod and a hand-written Pydantic model
here would compete with them.

Everything is frozen and every collection is a tuple: the acceptance criteria require that two
runs over the same file produce an identical IR, and immutability removes a whole class of ways
to accidentally depend on iteration order.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any

#: English Metric Units per point and per inch, the units OOXML stores geometry in.
EMU_PER_PT = 12700
EMU_PER_INCH = 914400


class WarningCode(StrEnum):
    """Something the parser could not represent fully but recovered from."""

    UNSUPPORTED_SHAPE = "unsupported-shape"
    UNRESOLVED_COLOR = "unresolved-color"
    MISSING_FONT_SCHEME = "missing-font-scheme"
    MISSING_THEME = "missing-theme"
    EMBEDDED_FONT_IGNORED = "embedded-font-ignored"
    UNREADABLE_MEDIA = "unreadable-media"
    NO_SLIDE_LAYOUT = "no-slide-layout"


@dataclass(frozen=True, slots=True)
class ParseWarning:
    """One recoverable problem, carrying enough context to act on it."""

    code: WarningCode
    message: str
    #: Where it happened: a part name, a slide index, or a shape id.
    location: str = ""


@dataclass(frozen=True, slots=True)
class Box:
    """Geometry in EMU, exactly as OOXML stores it."""

    x: int
    y: int
    cx: int
    cy: int


@dataclass(frozen=True, slots=True)
class Run:
    """One text run with the formatting that actually applies to it."""

    text: str
    #: Typeface named on the run itself. Empty when the run inherits from the theme.
    font: str = ""
    size_pt: float | None = None
    bold: bool | None = None
    italic: bool | None = None
    #: Resolved to a hex string when the colour could be determined, otherwise empty.
    color: str = ""


@dataclass(frozen=True, slots=True)
class Paragraph:
    """A paragraph and its runs, with the indent level that drives bullet depth."""

    level: int
    runs: tuple[Run, ...] = ()

    @property
    def text(self) -> str:
        return "".join(run.text for run in self.runs)


@dataclass(frozen=True, slots=True)
class Placeholder:
    """Placeholder identity, present only on shapes that inherit from a layout."""

    type: str
    idx: int | None


@dataclass(frozen=True, slots=True)
class Shape:
    """One shape, flattened out of its group but keeping the nesting path.

    ``path`` records the group chain, so a consumer can tell a top-level shape from one that only
    exists inside a group without having to walk a tree.
    """

    shape_id: int
    name: str
    kind: str
    box: Box | None
    rotation: float = 0.0
    flip_h: bool = False
    flip_v: bool = False
    #: Position in the drawing order of its parent, lowest first.
    z: int = 0
    path: tuple[int, ...] = ()
    placeholder: Placeholder | None = None
    paragraphs: tuple[Paragraph, ...] = ()
    #: Set for pictures: the media part this shape draws.
    media_part: str = ""
    #: Set for tables: rows and columns.
    table_size: tuple[int, int] | None = None
    #: Set for charts: the chart part and its type.
    chart_part: str = ""
    chart_type: str = ""


@dataclass(frozen=True, slots=True)
class SlideLike:
    """A slide, a layout or a master: the same structure at three levels of inheritance."""

    part: str
    name: str
    #: For a slide, the layout it follows; for a layout, its master. Empty at the top.
    follows: str = ""
    shapes: tuple[Shape, ...] = ()


@dataclass(frozen=True, slots=True)
class ThemeColors:
    """The twelve slots of an OOXML colour scheme, resolved to hex where possible."""

    name: str
    slots: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True, slots=True)
class ThemeFonts:
    """Major and minor typefaces declared by the theme."""

    major_latin: str = ""
    minor_latin: str = ""


@dataclass(frozen=True, slots=True)
class MediaItem:
    """One file in ppt/media, described without being copied anywhere."""

    part: str
    content_type: str
    bytes: int
    width_px: int | None = None
    height_px: int | None = None


@dataclass(frozen=True, slots=True)
class TemplateIR:
    """Everything the parser could establish about a template, before interpretation."""

    source_name: str
    slide_cx: int
    slide_cy: int
    theme_colors: tuple[ThemeColors, ...] = ()
    theme_fonts: ThemeFonts = field(default_factory=ThemeFonts)
    masters: tuple[SlideLike, ...] = ()
    layouts: tuple[SlideLike, ...] = ()
    slides: tuple[SlideLike, ...] = ()
    media: tuple[MediaItem, ...] = ()
    warnings: tuple[ParseWarning, ...] = ()

    @property
    def aspect(self) -> str:
        """Aspect ratio reduced to its simplest whole-number form, for reporting."""
        from math import gcd

        divisor = gcd(self.slide_cx, self.slide_cy) or 1
        return f"{self.slide_cx // divisor}:{self.slide_cy // divisor}"

    def to_dict(self) -> dict[str, Any]:
        """Flatten to the plain dictionary the layer boundary declares."""
        return asdict(self) | {"aspect": self.aspect}
