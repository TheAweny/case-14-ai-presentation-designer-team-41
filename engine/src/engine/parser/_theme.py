"""Theme resolution: colour scheme and font scheme, straight out of the theme part.

What the theme *declares* and what a template actually *uses* are two different things, and the
difference is not academic. In the templates this parser was developed against, every theme names
``Arial`` while the slides are set in another face entirely, and one theme carries the stock
Office palette while the brand colour appears only inside shapes.

So this module reports the theme faithfully and says nothing about whether it should be trusted.
Deciding which values describe the template is the design-system layer's job, and it needs the
declared values to compare against.
"""

from __future__ import annotations

import zipfile
from xml.etree import ElementTree

from engine.parser._model import ParseWarning, ThemeColors, ThemeFonts, WarningCode

_A = "http://schemas.openxmlformats.org/drawingml/2006/main"

#: The colour scheme slots, in the order OOXML declares them.
_SLOT_ORDER = (
    "dk1",
    "lt1",
    "dk2",
    "lt2",
    "accent1",
    "accent2",
    "accent3",
    "accent4",
    "accent5",
    "accent6",
    "hlink",
    "folHlink",
)


def _resolve_color(slot: ElementTree.Element) -> str:
    """Return the hex value of one colour slot, or an empty string when it is indirect.

    A slot holds either an explicit ``srgbClr`` or a ``sysClr`` that names a system colour and
    carries its last observed value. Anything else (a scheme reference, a preset name) cannot be
    resolved without a rendering context, and an empty string says so honestly.
    """
    srgb = slot.find(f"{{{_A}}}srgbClr")
    if srgb is not None:
        value = srgb.get("val", "")
        return value.upper() if value else ""

    system = slot.find(f"{{{_A}}}sysClr")
    if system is not None:
        value = system.get("lastClr", "")
        return value.upper() if value else ""

    return ""


def read_themes(
    archive: zipfile.ZipFile,
) -> tuple[tuple[ThemeColors, ...], ThemeFonts, tuple[ParseWarning, ...]]:
    """Read every theme part in the package.

    A package normally carries one theme per slide master, so the tuple is ordered by part name to
    keep repeated runs identical.
    """
    warnings: list[ParseWarning] = []
    palettes: list[ThemeColors] = []
    fonts = ThemeFonts()

    parts = sorted(n for n in archive.namelist() if n.startswith("ppt/theme/theme"))
    if not parts:
        warnings.append(
            ParseWarning(
                code=WarningCode.MISSING_THEME,
                message="package carries no theme part; colours and fonts stay unresolved",
            )
        )
        return (), fonts, tuple(warnings)

    for part in parts:
        try:
            root = ElementTree.fromstring(archive.read(part))
        except ElementTree.ParseError as exc:
            warnings.append(
                ParseWarning(
                    code=WarningCode.MISSING_THEME,
                    message=f"theme part is not well-formed XML: {exc}",
                    location=part,
                )
            )
            continue

        scheme = root.find(f".//{{{_A}}}clrScheme")
        if scheme is None:
            warnings.append(
                ParseWarning(
                    code=WarningCode.UNRESOLVED_COLOR,
                    message="theme has no colour scheme",
                    location=part,
                )
            )
        else:
            slots: list[tuple[str, str]] = []
            for name in _SLOT_ORDER:
                element = scheme.find(f"{{{_A}}}{name}")
                if element is None:
                    continue
                value = _resolve_color(element)
                if not value:
                    warnings.append(
                        ParseWarning(
                            code=WarningCode.UNRESOLVED_COLOR,
                            message=f"colour slot {name} is indirect and stays unresolved",
                            location=part,
                        )
                    )
                slots.append((name, value))
            palettes.append(ThemeColors(name=scheme.get("name", ""), slots=tuple(slots)))

        # The font scheme of the first theme wins: a package with several masters still has one
        # typographic identity, and picking the first keeps repeated runs identical.
        if fonts == ThemeFonts():
            fonts = _read_font_scheme(root, part, warnings)

    return tuple(palettes), fonts, tuple(warnings)


def _read_font_scheme(
    root: ElementTree.Element, part: str, warnings: list[ParseWarning]
) -> ThemeFonts:
    """Pull the major and minor latin typefaces out of a theme."""
    scheme = root.find(f".//{{{_A}}}fontScheme")
    if scheme is None:
        warnings.append(
            ParseWarning(
                code=WarningCode.MISSING_FONT_SCHEME,
                message="theme has no font scheme; typography must come from the slides",
                location=part,
            )
        )
        return ThemeFonts()

    major = scheme.find(f"{{{_A}}}majorFont/{{{_A}}}latin")
    minor = scheme.find(f"{{{_A}}}minorFont/{{{_A}}}latin")
    return ThemeFonts(
        major_latin=major.get("typeface", "") if major is not None else "",
        minor_latin=minor.get("typeface", "") if minor is not None else "",
    )
