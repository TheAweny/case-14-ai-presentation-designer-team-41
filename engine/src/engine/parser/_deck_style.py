"""How a finished slide is painted: theme, colours, fills, outlines and text properties.

Where ``_style`` records what a part states and keeps inheritance visible, this module resolves:
a scheme colour becomes the hex PowerPoint draws, through the colour map in force on the slide and
every transform written on it; a shape style reference becomes the fill or outline of the theme's
format scheme it points at. Reading a deck back as it looks needs exactly that, and needs it from
the file alone, so nothing here depends on a particular template.
"""

from __future__ import annotations

import colorsys
from dataclasses import dataclass, field
from typing import Any

import lxml.etree as etree

from engine.parser._design import _apply_transforms

_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"

#: Children that paint an area. A shape property element states at most one of them.
FILL_TAGS = frozenset(
    f"{_A}{name}" for name in ("noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill")
)

#: Colour transforms applied in the order they are written. Others are rare in slides and would
#: change the colour only slightly; they are read as if absent.
_TRANSFORMS = frozenset(("lumMod", "lumOff", "tint", "shade", "satMod", "satOff", "alpha"))

#: What an alias means when a part states no colour map: the OOXML default mapping.
DEFAULT_COLOR_MAP = {"bg1": "lt1", "tx1": "dk1", "bg2": "lt2", "tx2": "dk2"}

#: Named colours of ``a:prstClr`` (ST_PresetColorVal) that slides use in practice.
_PRESET_COLORS = {
    "black": "000000",
    "white": "FFFFFF",
    "red": "FF0000",
    "green": "008000",
    "lime": "00FF00",
    "blue": "0000FF",
    "yellow": "FFFF00",
    "cyan": "00FFFF",
    "aqua": "00FFFF",
    "magenta": "FF00FF",
    "fuchsia": "FF00FF",
    "gray": "808080",
    "grey": "808080",
    "ltGray": "D3D3D3",
    "ltGrey": "D3D3D3",
    "dkGray": "A9A9A9",
    "dkGrey": "A9A9A9",
    "silver": "C0C0C0",
    "orange": "FFA500",
    "purple": "800080",
    "navy": "000080",
    "maroon": "800000",
    "olive": "808000",
    "teal": "008080",
    "dkBlue": "00008B",
    "dkRed": "8B0000",
    "dkGreen": "006400",
}

#: ``a:sysClr`` values without a ``lastClr``: the two that appear in themes.
_SYSTEM_COLORS = {"windowText": "000000", "window": "FFFFFF"}

Color = tuple[str, float]


@dataclass(frozen=True)
class Paint:
    """How an area is painted once resolved.

    ``kind`` is ``none``, ``solid``, ``image`` (``blip`` holds the ``a:blipFill``) or ``group``
    (the shape takes the fill of the group it sits in).
    """

    kind: str
    color: str | None = None
    alpha: float = 1.0
    blip: Any = None


@dataclass
class Theme:
    colors: dict[str, str] = field(default_factory=dict)
    major: str = ""
    minor: str = ""
    fill_styles: list[Any] = field(default_factory=list)
    bg_fill_styles: list[Any] = field(default_factory=list)
    line_styles: list[Any] = field(default_factory=list)


def read_theme(blob: bytes | None) -> Theme:
    """Colour scheme, Latin typefaces and format scheme of one theme part."""
    if not blob:
        return Theme()
    try:
        root = etree.fromstring(blob)
    except etree.XMLSyntaxError:
        return Theme()
    theme = Theme()
    scheme = root.find(f".//{_A}clrScheme")
    if scheme is not None:
        plain = Colors(theme, {})
        for slot in scheme:
            name = etree.QName(slot).localname
            resolved = plain.first(slot)
            if resolved is not None:
                theme.colors[name] = resolved[0]
    major = root.find(f".//{_A}fontScheme/{_A}majorFont/{_A}latin")
    minor = root.find(f".//{_A}fontScheme/{_A}minorFont/{_A}latin")
    theme.major = major.get("typeface", "") if major is not None else ""
    theme.minor = minor.get("typeface", "") if minor is not None else ""
    formats = root.find(f".//{_A}fmtScheme")
    if formats is not None:
        for attr, tag in (
            ("fill_styles", "fillStyleLst"),
            ("bg_fill_styles", "bgFillStyleLst"),
            ("line_styles", "lnStyleLst"),
        ):
            styles = formats.find(f"{_A}{tag}")
            setattr(theme, attr, list(styles) if styles is not None else [])
    return theme


def _hex(rgb: tuple[float, float, float]) -> str:
    return "".join(f"{round(max(0.0, min(1.0, c)) * 255):02X}" for c in rgb)


def _gamma(c: float) -> float:
    c = max(0.0, min(1.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def _percent(element: Any, name: str) -> float:
    try:
        return int(element.get(name, "0")) / 100000
    except ValueError:
        return 0.0


class Colors:
    """Resolves DrawingML colour elements against one theme and one colour map."""

    def __init__(self, theme: Theme, color_map: dict[str, str]) -> None:
        self.theme = theme
        self.color_map = {**DEFAULT_COLOR_MAP, **color_map}

    def scheme(self, name: str) -> str | None:
        """Hex of a scheme colour or alias, as the colour map in force reads it."""
        slot = self.color_map.get(name, name)
        return self.theme.colors.get(slot) or self.theme.colors.get(name)

    def _base(self, element: Any, placeholder: Color | None) -> Color | None:
        name = etree.QName(element).localname
        if name == "srgbClr":
            value = element.get("val", "")
            return (value.upper(), 1.0) if len(value) == 6 else None
        if name == "schemeClr":
            value = element.get("val", "")
            if value == "phClr":
                return placeholder
            resolved = self.scheme(value)
            return (resolved, 1.0) if resolved else None
        if name == "sysClr":
            value = element.get("lastClr") or _SYSTEM_COLORS.get(element.get("val", ""), "")
            return (value.upper(), 1.0) if value else None
        if name == "prstClr":
            value = _PRESET_COLORS.get(element.get("val", ""))
            return (value, 1.0) if value else None
        if name == "scrgbClr":
            rgb = tuple(_gamma(_percent(element, c)) for c in ("r", "g", "b"))
            return _hex((rgb[0], rgb[1], rgb[2])), 1.0
        if name == "hslClr":
            try:
                hue = int(element.get("hue", "0")) / 60000 / 360
            except ValueError:
                hue = 0.0
            rgb = colorsys.hls_to_rgb(hue, _percent(element, "lum"), _percent(element, "sat"))
            return _hex(rgb), 1.0
        return None

    def of_element(self, element: Any, placeholder: Color | None = None) -> Color | None:
        """Colour of one colour element with its transforms applied, or None if unresolvable."""
        base = self._base(element, placeholder)
        if base is None:
            return None
        transforms: list[tuple[str, int]] = []
        for child in element:
            name = etree.QName(child).localname
            if name not in _TRANSFORMS:
                continue
            try:
                transforms.append((name, int(child.get("val", "0"))))
            except ValueError:
                continue
        if not transforms:
            return base
        value, alpha = _apply_transforms(base[0], transforms)
        return value, alpha * base[1]

    def first(self, parent: Any, placeholder: Color | None = None) -> Color | None:
        """The colour a fill-like element carries, or None when it carries none."""
        if parent is None:
            return None
        for child in parent:
            if not isinstance(child.tag, str):
                continue
            resolved = self.of_element(child, placeholder)
            if resolved is not None:
                return resolved
        return None


def mean_hex(colors: list[Color]) -> Color | None:
    """Mean of several colours, which is how a gradient reads from a distance."""
    if not colors:
        return None
    channels = [
        sum(int(value[i : i + 2], 16) for value, _ in colors) / len(colors) for i in (0, 2, 4)
    ]
    alpha = sum(a for _, a in colors) / len(colors)
    return "".join(f"{round(c):02X}" for c in channels), alpha


def fill_child(props: Any) -> Any:
    """The element that paints an area, stated directly on a property element, or None."""
    if props is None:
        return None
    for child in props:
        if child.tag in FILL_TAGS:
            return child
    return None


def paint_of(fill: Any, colors: Colors, placeholder: Color | None = None) -> Paint:
    """Resolve one fill element (``a:solidFill``, ``a:gradFill`` ...)."""
    name = etree.QName(fill).localname
    if name == "noFill":
        return Paint("none")
    if name == "grpFill":
        return Paint("group")
    if name == "blipFill":
        return Paint("image", blip=fill)
    if name == "solidFill":
        resolved = colors.first(fill, placeholder)
    elif name == "gradFill":
        stops = [colors.first(stop, placeholder) for stop in fill.iter(f"{_A}gs")]
        resolved = mean_hex([stop for stop in stops if stop is not None])
    elif name == "pattFill":
        resolved = colors.first(fill.find(f"{_A}fgClr"), placeholder)
    else:
        resolved = None
    if resolved is None:
        return Paint("none")
    return Paint("solid", resolved[0], resolved[1])


def _style_index(reference: Any) -> int:
    try:
        return int(reference.get("idx", "0"))
    except ValueError:
        return 0


def style_fill(reference: Any, colors: Colors) -> Paint:
    """The fill a shape style's ``a:fillRef`` points at in the theme's format scheme."""
    index = _style_index(reference)
    placeholder = colors.first(reference)
    if index == 0:
        return Paint("none")
    styles = colors.theme.fill_styles if index < 1000 else colors.theme.bg_fill_styles
    position = index - 1 if index < 1000 else index - 1001
    if 0 <= position < len(styles):
        return paint_of(styles[position], colors, placeholder)
    if placeholder is None:
        return Paint("none")
    return Paint("solid", placeholder[0], placeholder[1])


def style_line(reference: Any, colors: Colors) -> tuple[Any, Color | None]:
    """The theme outline a shape style's ``a:lnRef`` points at, and the colour it is drawn in.

    Index zero means no outline, which comes back as ``(None, None)``.
    """
    index = _style_index(reference)
    if index == 0:
        return None, None
    styles = colors.theme.line_styles
    line = styles[index - 1] if 0 < index <= len(styles) else None
    return line, colors.first(reference)


# ------------------------------------------------------------------------------- text properties

_ALIGN = {
    "l": "left",
    "ctr": "center",
    "r": "right",
    "just": "justify",
    "justLow": "justify",
    "dist": "justify",
    "thaiDist": "justify",
}


def _int(element: Any, name: str) -> int | None:
    value = element.get(name)
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _bool(value: str | None) -> bool | None:
    if value is None:
        return None
    return value in ("1", "true", "on")


def _spacing(element: Any) -> tuple[str, float] | None:
    """``a:spcPct`` or ``a:spcPts`` inside a spacing element, in its own unit."""
    if element is None:
        return None
    percent = element.find(f"{_A}spcPct")
    if percent is not None:
        return "pct", (_int(percent, "val") or 0) / 100000
    points = element.find(f"{_A}spcPts")
    if points is not None:
        return "pts", (_int(points, "val") or 0) / 100
    return None


def paragraph_props(ppr: Any) -> dict[str, Any]:
    """What one paragraph-property element (``a:pPr``, ``a:lvl1pPr`` ...) states."""
    props: dict[str, Any] = {}
    if ppr is None:
        return props
    align = ppr.get("algn")
    if align in _ALIGN:
        props["align"] = _ALIGN[align]
    for key, attr in (("marL", "marL"), ("indent", "indent")):
        value = _int(ppr, attr)
        if value is not None:
            props[key] = value
    for key, tag in (("lnSpc", "lnSpc"), ("spcBef", "spcBef"), ("spcAft", "spcAft")):
        value = _spacing(ppr.find(f"{_A}{tag}"))
        if value is not None:
            props[key] = value
    for child in ppr:
        name = etree.QName(child).localname if isinstance(child.tag, str) else ""
        if name == "buNone":
            props["bullet"] = ("none",)
        elif name == "buChar":
            props["bullet"] = ("char", child.get("char", "•"))
        elif name == "buAutoNum":
            props["bullet"] = ("auto", child.get("type", "arabicPeriod"), _int(child, "startAt"))
        elif name == "buBlip":
            props["bullet"] = ("char", "•")
    return props


def run_props(rpr: Any, colors: Colors, theme: Theme) -> dict[str, Any]:
    """What one run-property element (``a:rPr``, ``a:defRPr`` ...) states, resolved."""
    props: dict[str, Any] = {}
    if rpr is None:
        return props
    size = _int(rpr, "sz")
    if size is not None:
        props["size"] = size / 100
    for key in ("b", "i"):
        value = _bool(rpr.get(key))
        if value is not None:
            props[key] = value
    underline = rpr.get("u")
    if underline is not None:
        props["u"] = underline != "none"
    spacing = _int(rpr, "spc")
    if spacing is not None:
        props["spc"] = spacing / 100
    latin = rpr.find(f"{_A}latin")
    if latin is not None:
        face = typeface(latin.get("typeface", ""), theme)
        if face:
            props["font"] = face
    fill = fill_child(rpr)
    if fill is not None:
        paint = paint_of(fill, colors)
        if paint.kind == "solid" and paint.color:
            props["color"] = paint.color
    return props


def typeface(name: str, theme: Theme) -> str:
    """A typeface as drawn: theme references (``+mj-lt``, ``+mn-ea`` ...) become theme faces."""
    if name.startswith("+mj"):
        return theme.major
    if name.startswith("+mn"):
        return theme.minor
    return name
