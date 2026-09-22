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

#: Version of the shared TemplateIR contract this module produces. Raised by any incompatible
#: change, and kept in step with packages/contracts/src/template-ir.ts.
TEMPLATE_IR_SCHEMA_VERSION = 1

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
class ColorRef:
    """A colour as the file states it: an explicit value or a theme slot, never resolved here.

    Resolving a theme reference needs the master's colour map and theme, and substituting the
    result at parse time would erase the difference between a brand colour the template inherits
    and a one-off override. The design-system layer does the resolving.
    """

    #: Six hex digits when the colour is stated outright, otherwise empty.
    hex: str = ""
    #: Theme slot or alias (accent1, tx1, bg2 ...) when the colour refers to the theme.
    scheme: str = ""
    #: Transforms applied on top of the base colour, in document order, each with its value as
    #: OOXML stores it: thousandths of a percent, so 65000 is 65 %.
    transforms: tuple[tuple[str, int], ...] = ()


@dataclass(frozen=True, slots=True)
class Fill:
    """How an area is painted."""

    #: solid, gradient, image, pattern or none.
    kind: str
    #: Set for a solid fill.
    color: ColorRef | None = None
    #: Gradient stops in order, for a gradient fill.
    stops: tuple[ColorRef, ...] = ()


@dataclass(frozen=True, slots=True)
class Stroke:
    """The outline a shape states for itself."""

    #: False when the outline is explicitly switched off.
    visible: bool
    color: ColorRef | None = None
    width_emu: int | None = None


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
    #: Line spacing as a multiple of single spacing, when stated as a percentage.
    line_spacing: float | None = None

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
    #: Fill and outline the shape states for itself. Absent means it inherits them.
    fill: Fill | None = None
    stroke: Stroke | None = None
    #: Preset geometry, such as rect or roundRect. Empty for custom geometry and pictures.
    geometry: str = ""
    #: Corner radius of a rounded rectangle in EMU, from its adjust value and its size.
    corner_radius_emu: int | None = None
    has_shadow: bool = False


@dataclass(frozen=True, slots=True)
class SlideLike:
    """A slide, a layout or a master: the same structure at three levels of inheritance."""

    part: str
    name: str
    #: For a slide, the layout it follows; for a layout, its master. Empty at the top.
    follows: str = ""
    shapes: tuple[Shape, ...] = ()
    #: Background the part states for itself. Absent means it inherits one.
    background: Fill | None = None
    #: For a master, the theme part its colours and fonts come from. Empty below the master.
    theme: str = ""
    #: For a master, how the aliases map to theme slots (bg1 to lt1 and so on). Below the
    #: master only an explicit override is recorded, and empty means the master's map applies.
    color_map: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True, slots=True)
class ThemeColors:
    """The twelve slots of an OOXML colour scheme, resolved to hex where possible."""

    name: str
    slots: tuple[tuple[str, str], ...] = ()
    #: Theme part this scheme lives in, spelled the way a master refers to it.
    part: str = ""


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
        """Flatten to the shape the shared ``TemplateIR`` contract declares.

        Keys come out in camel case because the contract is generated from Zod, where that is the
        house style. Converting here rather than renaming the dataclass fields keeps the Python
        side readable and puts the single translation at the one place that crosses the boundary.
        """
        payload = _camelize(asdict(self))
        payload["aspect"] = self.aspect
        payload["schemaVersion"] = TEMPLATE_IR_SCHEMA_VERSION
        return payload


def _camelize(value: Any) -> Any:
    """Recursively rewrite ``snake_case`` mapping keys as ``camelCase``.

    Tuples become lists on the way out. ``asdict`` keeps the tuples the dataclasses use, and JSON
    has no such type, so leaving them would produce a payload that changes shape the moment it
    crosses the boundary it was built for.
    """
    if isinstance(value, dict):
        return {_camel_key(key): _camelize(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_camelize(item) for item in value]
    return value


def _camel_key(key: str) -> str:
    head, *rest = key.split("_")
    return head + "".join(word.capitalize() for word in rest)
