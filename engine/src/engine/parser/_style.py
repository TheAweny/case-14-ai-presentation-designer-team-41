"""Visual properties read straight off the XML: fills, outlines, geometry, colour references.

python-pptx exposes some of this and hides the rest behind properties that resolve or raise, so
this module reads the DrawingML elements directly. It records what the file states and nothing
more. A shape without a fill element has no fill here, because it inherits one, and telling
inheritance from an explicit value is the whole reason the two are kept apart.
"""

from __future__ import annotations

from typing import Any

from engine.parser._model import ColorRef, Fill, Stroke

_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
_P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"

#: Colour transforms worth keeping. Each changes the colour a reader actually sees, and dropping
#: any of them makes a resolved value disagree with what PowerPoint draws.
_TRANSFORMS = ("lumMod", "lumOff", "tint", "shade", "satMod", "satOff", "alpha")

#: Preset colour names that appear in real templates. Anything rarer resolves to nothing, which
#: the design-system layer reports rather than guesses.
_PRESET_COLORS = {"black": "000000", "white": "FFFFFF"}

#: OOXML default for the corner adjustment of a rounded rectangle, and its upper bound: past a
#: half of the shorter side the corners would overlap.
_ROUND_RECT_DEFAULT_ADJ = 16667
_ROUND_RECT_MAX_ADJ = 50000


def _transforms(element: Any) -> tuple[tuple[str, int], ...]:
    found: list[tuple[str, int]] = []
    for child in element:
        name = str(child.tag).removeprefix(_A)
        if name not in _TRANSFORMS:
            continue
        try:
            found.append((name, int(child.get("val", "0"))))
        except ValueError:
            continue
    return tuple(found)


def color_ref(parent: Any) -> ColorRef | None:
    """The colour carried by a fill-like element, or None when it carries none."""
    if parent is None:
        return None
    for child in parent:
        tag = str(child.tag)
        if tag == f"{_A}srgbClr":
            return ColorRef(hex=child.get("val", "").upper(), transforms=_transforms(child))
        if tag == f"{_A}schemeClr":
            return ColorRef(scheme=child.get("val", ""), transforms=_transforms(child))
        if tag == f"{_A}sysClr":
            return ColorRef(hex=child.get("lastClr", "").upper(), transforms=_transforms(child))
        if tag == f"{_A}prstClr":
            return ColorRef(
                hex=_PRESET_COLORS.get(child.get("val", ""), ""), transforms=_transforms(child)
            )
    return None


def fill_of(props: Any) -> Fill | None:
    """The fill stated directly on a property element such as spPr or bgPr.

    Only direct children are read. The outline carries a solidFill of its own inside ln, and
    reading recursively would mistake the colour of a border for the colour of the area.
    """
    if props is None:
        return None
    for child in props:
        tag = str(child.tag)
        if tag == f"{_A}noFill":
            return Fill(kind="none")
        if tag == f"{_A}solidFill":
            return Fill(kind="solid", color=color_ref(child))
        if tag == f"{_A}gradFill":
            stops = tuple(ref for ref in (color_ref(stop) for stop in child.iter(f"{_A}gs")) if ref)
            return Fill(kind="gradient", stops=stops)
        if tag == f"{_A}blipFill":
            return Fill(kind="image")
        if tag == f"{_A}pattFill":
            return Fill(kind="pattern")
    return None


def stroke_of(props: Any) -> Stroke | None:
    """The outline stated on a shape, or None when it inherits one."""
    if props is None:
        return None
    line = props.find(f"{_A}ln")
    if line is None:
        return None
    if line.find(f"{_A}noFill") is not None:
        return Stroke(visible=False)
    width = line.get("w", "")
    return Stroke(
        visible=True,
        color=color_ref(line.find(f"{_A}solidFill")),
        width_emu=int(width) if width.isdigit() else None,
    )


def geometry_of(props: Any, cx: int | None, cy: int | None) -> tuple[str, int | None]:
    """Preset geometry and, for a rounded rectangle, its corner radius in EMU.

    The radius is what a reader sees, so it is computed rather than reported as the raw adjust
    value: the same adjust on a small badge and on a large card gives visibly different corners,
    and two templates that look alike can store very different numbers.
    """
    if props is None:
        return "", None
    geometry = props.find(f"{_A}prstGeom")
    if geometry is None:
        return "", None
    preset = geometry.get("prst", "")
    if preset != "roundRect" or not cx or not cy:
        return preset, None

    adjust = _ROUND_RECT_DEFAULT_ADJ
    for guide in geometry.iter(f"{_A}gd"):
        formula = guide.get("fmla", "")
        if guide.get("name") == "adj" and formula.startswith("val "):
            try:
                adjust = int(formula.removeprefix("val "))
            except ValueError:
                break
    adjust = max(0, min(adjust, _ROUND_RECT_MAX_ADJ))
    return preset, round(min(cx, cy) * adjust / 100000)


def has_shadow(props: Any) -> bool:
    """Whether the shape states an outer shadow of its own.

    A shadow can also arrive through the theme's effect styles. That path is not followed: none
    of the templates this was written against use it, and reporting it would need a model of the
    theme's style matrix for a case nobody has seen.
    """
    if props is None:
        return False
    effects = props.find(f"{_A}effectLst")
    return effects is not None and effects.find(f"{_A}outerShdw") is not None


def background_of(container: Any) -> Fill | None:
    """The background a slide, layout or master states for itself."""
    background = container.find(f"{_P}cSld/{_P}bg")
    if background is None:
        return None
    properties = background.find(f"{_P}bgPr")
    if properties is not None:
        return fill_of(properties)
    reference = background.find(f"{_P}bgRef")
    if reference is not None:
        # bgRef points at a background style in the theme and names the colour to paint it
        # with. Every template seen so far uses a plain style, so the colour is what matters.
        return Fill(kind="solid", color=color_ref(reference))
    return None


def color_map_of(container: Any) -> tuple[tuple[str, str], ...]:
    """The alias map a part states: in full on a master, only as an override below it."""
    mapping = container.find(f"{_P}clrMap")
    if mapping is None:
        mapping = container.find(f"{_P}clrMapOvr/{_A}overrideClrMapping")
    if mapping is None:
        return ()
    return tuple(sorted(mapping.attrib.items()))
