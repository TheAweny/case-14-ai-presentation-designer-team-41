"""From the IR of a template to its design system: the values a layout should reuse.

The IR records the file. This module decides which of those values characterise the template,
and it decides by measurement first. A theme is what the author declared; the slides are what
the author did, and in the templates this was written against the two disagree often enough
that trusting the theme produces a deck in the wrong typeface and, in one case, the stock Office
palette.

Three rules hold throughout, and the tests pin each of them:

* Every value carries its evidence: where it came from, how many occurrences support it, what
  share of the relevant population agrees, and a confidence derived from both. A low confidence
  is reported and turned into a warning, never rounded up.
* Nothing depends on the order of slides. Every choice is a count with a deterministic tie-break,
  so shuffling the deck gives the same design system.
* When a value cannot be observed, the theme stands in, and when the theme cannot either, a
  fallback does, and each substitution says so in ``warnings``.
"""

from __future__ import annotations

import colorsys
import re
from collections import Counter, defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from fractions import Fraction
from typing import Any

from engine.parser._model import (
    EMU_PER_INCH,
    EMU_PER_PT,
    Box,
    ColorRef,
    Fill,
    Shape,
    SlideLike,
    TemplateIR,
)

#: How the text and background aliases map to theme slots when a master states nothing.
_DEFAULT_COLOR_MAP = {
    "bg1": "lt1",
    "tx1": "dk1",
    "bg2": "lt2",
    "tx2": "dk2",
    "accent1": "accent1",
    "accent2": "accent2",
    "accent3": "accent3",
    "accent4": "accent4",
    "accent5": "accent5",
    "accent6": "accent6",
    "hlink": "hlink",
    "folHlink": "folHlink",
}

_TITLE_TYPES = frozenset({"title", "center-title"})
_SUBTITLE_TYPES = frozenset({"subtitle"})
_BODY_TYPES = frozenset({"body", "object"})
_FOOTER_TYPES = frozenset({"footer"})
_NUMBER_TYPES = frozenset({"slide-number"})

_MONO = re.compile(r"consol|courier|mono|menlo|monaco|source code|fira code|jetbrains", re.I)

#: Sample sizes at which a measurement is trusted half-way. Characters are cheap and plentiful,
#: shapes and slides much less so, hence the different scales.
_K_CHARS = 40
_K_ITEMS = 6

_CONFIDENCE_THEME = 0.5
_CONFIDENCE_FALLBACK = 0.2
_LOW_CONFIDENCE = 0.5

#: A shape that covers this much of the slide is a background panel, not a use of colour.
_PANEL_AREA = 0.7
#: Below this chroma a colour is a neutral: a grey, a near-white, a near-black.
_CHROMATIC_SATURATION = 0.2
#: Minimum contrast for a colour to count as text on a background. Below it the run is a
#: decoration or an accent, not something a reader is meant to read against that surface.
_READABLE_CONTRAST = 3.0
#: Relative luminance above which a background is light.
_LIGHT_LUMINANCE = 0.4

_FALLBACK_FONTS = ("Arial", "Liberation Sans", "DejaVu Sans")
_FALLBACK_MONO = ("Courier New", "Liberation Mono", "DejaVu Sans Mono")

#: Rounding for margins before they are compared: a hundredth of an inch, finer than anyone
#: aligns by hand and coarse enough to merge placeholders that are "the same" in the designer's
#: eye but a few EMU apart in the file.
_MARGIN_STEP = 9144

RGB = tuple[float, float, float]


# ---------------------------------------------------------------------------------- colour math


def _to_rgb(hex_value: str) -> RGB:
    return (
        int(hex_value[0:2], 16) / 255,
        int(hex_value[2:4], 16) / 255,
        int(hex_value[4:6], 16) / 255,
    )


def _to_hex(rgb: RGB) -> str:
    return "".join(f"{round(max(0.0, min(1.0, c)) * 255):02X}" for c in rgb)


def _linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _gamma(c: float) -> float:
    c = max(0.0, min(1.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def _luminance(hex_value: str) -> float:
    r, g, b = (_linear(c) for c in _to_rgb(hex_value))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(a: str, b: str) -> float:
    high, low = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (high + 0.05) / (low + 0.05)


def _hls(hex_value: str) -> tuple[float, float, float]:
    return colorsys.rgb_to_hls(*_to_rgb(hex_value))


def _chroma(hex_value: str) -> float:
    rgb = _to_rgb(hex_value)
    return max(rgb) - min(rgb)


def _is_chromatic(hex_value: str) -> bool:
    """Whether a colour reads as a colour rather than a grey.

    Chroma, not HSL saturation: saturation blows up near white and black, so a near-white like
    EBF3F9 scores as vivid in HSL while nobody would call it an accent.
    """
    return _chroma(hex_value) >= _CHROMATIC_SATURATION


def _hue(hex_value: str) -> float:
    return _hls(hex_value)[0] * 360


def _apply_transforms(hex_value: str, transforms: Iterable[tuple[str, int]]) -> tuple[str, float]:
    """Apply DrawingML colour transforms, returning the colour and its opacity.

    Luminance and saturation transforms work in HSL, as the specification defines them. Tint and
    shade are applied in linear RGB, which is what PowerPoint does and what makes a 50 % tint of a
    brand colour match the swatch a designer sees.
    """
    rgb = _to_rgb(hex_value)
    alpha = 1.0
    for name, value in transforms:
        factor = value / 100000
        if name in ("lumMod", "lumOff", "satMod", "satOff"):
            hue, lightness, saturation = colorsys.rgb_to_hls(*rgb)
            if name == "lumMod":
                lightness *= factor
            elif name == "lumOff":
                lightness += factor
            elif name == "satMod":
                saturation *= factor
            else:
                saturation += factor
            rgb = colorsys.hls_to_rgb(
                hue, max(0.0, min(1.0, lightness)), max(0.0, min(1.0, saturation))
            )
        elif name == "tint":
            rgb = (
                _gamma(_linear(rgb[0]) * factor + 1 - factor),
                _gamma(_linear(rgb[1]) * factor + 1 - factor),
                _gamma(_linear(rgb[2]) * factor + 1 - factor),
            )
        elif name == "shade":
            rgb = (
                _gamma(_linear(rgb[0]) * factor),
                _gamma(_linear(rgb[1]) * factor),
                _gamma(_linear(rgb[2]) * factor),
            )
        elif name == "alpha":
            alpha = factor
    return _to_hex(rgb), alpha


# ------------------------------------------------------------------------------------- evidence


class _Tally:
    """Weighted counts that remember where each value was seen.

    Ranking is by weight and then by the value itself, so two values with the same support always
    come out in the same order however the deck was shuffled.
    """

    def __init__(self) -> None:
        self.weight: defaultdict[Any, float] = defaultdict(float)
        self.parts: defaultdict[Any, set[str]] = defaultdict(set)

    def add(self, key: Any, weight: float, part: str) -> None:
        if weight <= 0:
            return
        self.weight[key] += weight
        self.parts[key].add(part)

    @property
    def total(self) -> float:
        return float(sum(self.weight.values()))

    def ranked(self) -> list[tuple[Any, float]]:
        return sorted(self.weight.items(), key=lambda item: (-item[1], str(item[0])))

    def top(self) -> tuple[Any, float] | None:
        ranked = self.ranked()
        return ranked[0] if ranked else None

    def parts_of(self, key: Any) -> list[str]:
        return sorted(self.parts[key])[:3]


def _meta(
    source: str,
    count: float,
    total: float,
    parts: Iterable[str] = (),
    k: float = _K_ITEMS,
) -> dict[str, Any]:
    """Evidence for one token, in the shape the contract declares."""
    share = count / total if total else 0.0
    if source == "observed":
        confidence = share * (total / (total + k)) if total else 0.0
    elif source == "theme":
        confidence = _CONFIDENCE_THEME
    else:
        confidence = _CONFIDENCE_FALLBACK
    return {
        "source": source,
        "count": round(count),
        "share": round(min(1.0, share), 3),
        "confidence": round(min(1.0, confidence), 3),
        "parts": sorted(parts)[:3],
    }


@dataclass(slots=True)
class _Warnings:
    items: list[dict[str, str]]

    def add(self, code: str, token: str, message: str) -> None:
        entry = {"code": code, "token": token, "message": message}
        if entry not in self.items:
            self.items.append(entry)

    def sorted(self) -> list[dict[str, str]]:
        return sorted(self.items, key=lambda w: (w["code"], w["token"], w["message"]))


# ----------------------------------------------------------------------------- the template graph


class _Template:
    """The IR with inheritance made navigable and colours made resolvable."""

    def __init__(self, ir: TemplateIR, warnings: _Warnings) -> None:
        self.ir = ir
        self.warnings = warnings
        self.masters = {c.part: c for c in ir.masters}
        self.by_part: dict[str, SlideLike] = {
            c.part: c for group in (ir.masters, ir.layouts, ir.slides) for c in group
        }
        self.themes = {t.part: {slot: value for slot, value in t.slots} for t in ir.theme_colors}
        self.area = ir.slide_cx * ir.slide_cy
        self._context_cache: dict[str, tuple[dict[str, str], dict[str, str]]] = {}
        self._on_fill: dict[str, _Tally] | None = None

    def text_on_fill(self) -> dict[str, _Tally]:
        """Text colours observed inside shapes, keyed by the colour those shapes are filled with.

        This is the template's own answer to "what goes on this colour", and it is worth more
        than any contrast formula: the formula prefers black on a mid blue, while the template
        itself puts white on it.
        """
        if self._on_fill is None:
            on_fill: defaultdict[str, _Tally] = defaultdict(_Tally)
            for container in self.all_parts():
                for shape in container.shapes:
                    fill = self.resolve_fill(shape.fill, container.part)
                    if not fill or fill[1] < 0.3:
                        continue
                    for paragraph in shape.paragraphs:
                        for run in paragraph.runs:
                            if run.color and run.text.strip():
                                on_fill[fill[0]].add(
                                    run.color, len(run.text.strip()), container.part
                                )
            self._on_fill = dict(on_fill)
        return self._on_fill

    def chain(self, part: str) -> list[SlideLike]:
        """The part and everything it inherits from, nearest first, ending at its master."""
        chain: list[SlideLike] = []
        seen: set[str] = set()
        current = self.by_part.get(part)
        while current is not None and current.part not in seen:
            chain.append(current)
            seen.add(current.part)
            if current.part in self.masters:
                break
            current = self.by_part.get(current.follows)
        return chain

    def _context(self, part: str) -> tuple[dict[str, str], dict[str, str]]:
        """Theme slots and alias map in force for one part."""
        if part in self._context_cache:
            return self._context_cache[part]
        chain = self.chain(part)
        master = chain[-1] if chain and chain[-1].part in self.masters else None

        slots: dict[str, str] = {}
        if master is not None and master.theme in self.themes:
            slots = self.themes[master.theme]
        elif self.themes:
            # A master that names no theme, or one the package does not carry. The first theme
            # is the only reasonable stand-in, and the resolved colours are flagged below.
            slots = self.themes[sorted(self.themes)[0]]
            self.warnings.add(
                "unresolved-color",
                "palette",
                f"{part} names no usable theme; its theme colours were resolved against "
                f"{sorted(self.themes)[0]}",
            )

        mapping = dict(_DEFAULT_COLOR_MAP)
        for container in reversed(chain):
            mapping.update(dict(container.color_map))

        self._context_cache[part] = (slots, mapping)
        return slots, mapping

    def resolve(self, ref: ColorRef | None, part: str) -> tuple[str, float] | None:
        """Hex value and opacity of a colour reference, as a reader of this part sees it."""
        if ref is None:
            return None
        base = ref.hex
        if not base and ref.scheme:
            if ref.scheme == "phClr":
                return None  # a placeholder colour: it only means something inside a style
            slots, mapping = self._context(part)
            base = slots.get(mapping.get(ref.scheme, ref.scheme), "")
        if not re.fullmatch(r"[0-9A-Fa-f]{6}", base or ""):
            return None
        return _apply_transforms(base.upper(), ref.transforms)

    def resolve_fill(self, fill: Fill | None, part: str) -> tuple[str, float] | None:
        """The colour a fill paints with, for a solid fill or the first stop of a gradient."""
        if fill is None:
            return None
        if fill.kind == "solid":
            return self.resolve(fill.color, part)
        if fill.kind == "gradient" and fill.stops:
            return self.resolve(fill.stops[0], part)
        return None

    def background(self, part: str) -> str | None:
        """Effective background colour of a part, following inheritance up to the master."""
        for container in self.chain(part):
            if container.background is None:
                continue
            if container.background.kind in ("image", "pattern", "none"):
                return None
            resolved = self.resolve_fill(container.background, part)
            return resolved[0] if resolved else None
        # A part that states no background anywhere shows bg1, which is what PowerPoint draws.
        resolved = self.resolve(ColorRef(scheme="bg1"), part)
        return resolved[0] if resolved else None

    def usable_parts(self) -> list[SlideLike]:
        """Layouts and slides: the parts a deck is actually built on."""
        return sorted((*self.ir.layouts, *self.ir.slides), key=lambda c: c.part)

    def all_parts(self) -> list[SlideLike]:
        return sorted((*self.ir.masters, *self.ir.layouts, *self.ir.slides), key=lambda c: c.part)

    def area_share(self, shape: Shape) -> float:
        if shape.box is None or not self.area:
            return 0.0
        return (shape.box.cx * shape.box.cy) / self.area

    def on_slide(self, shape: Shape) -> bool:
        """Whether a shape sits on the canvas. Designers park spare assets off to the side."""
        box = shape.box
        if box is None:
            return False
        return (
            box.x + box.cx > 0
            and box.y + box.cy > 0
            and box.x < self.ir.slide_cx
            and box.y < self.ir.slide_cy
        )


def _runs(container: SlideLike) -> Iterator[tuple[Shape, Any, Any]]:
    """Every run with visible text, with the shape and paragraph it belongs to."""
    for shape in container.shapes:
        for paragraph in shape.paragraphs:
            for run in paragraph.runs:
                if run.text.strip():
                    yield shape, paragraph, run


def _placeholder_type(shape: Shape) -> str:
    return shape.placeholder.type if shape.placeholder else ""


def _has_own_fill(shape: Shape) -> bool:
    return shape.fill is not None and shape.fill.kind not in ("none",)


# -------------------------------------------------------------------------------------- surfaces


def _text_on(t: _Template, colour: str, part: str) -> tuple[str, dict[str, Any], str | None]:
    """Text colour for a background, the evidence behind it, and a note when it is a stand-in.

    Three sources, in order. What the template itself puts on this colour anywhere. Failing
    that, the theme's text and background colours, since text that states no colour inherits one
    of them. Failing that, contrast alone.

    On a saturated colour the lightest readable option wins over the highest-contrast one. By
    the numbers black edges out white on a mid brand blue, but every template examined sets
    white on its brand colour, and a contrast formula has no way to know that.
    """
    observed = t.text_on_fill().get(colour)
    if observed is not None and observed.weight:
        ranked = observed.ranked()
        neutral = [(h, w) for h, w in ranked if not _is_chromatic(h)]
        hex_value, weight = (neutral or ranked)[0]
        return (
            hex_value,
            _meta("observed", weight, observed.total, observed.parts_of(hex_value), k=_K_CHARS),
            None,
        )

    options: list[tuple[str, str]] = []
    for alias in ("tx1", "tx2", "bg1", "bg2"):
        resolved = t.resolve(ColorRef(scheme=alias), part)
        if resolved and _contrast(resolved[0], colour) >= _READABLE_CONTRAST:
            options.append((alias, resolved[0]))
    if options:
        if _is_chromatic(colour):
            alias, hex_value = max(options, key=lambda o: (_luminance(o[1]), o[0]))
        else:
            alias, hex_value = max(options, key=lambda o: (_contrast(o[1], colour), o[0]))
        return hex_value, _meta("theme", 0, 0), f"the theme's {alias} ({hex_value}) stands in"

    white = _contrast("FFFFFF", colour)
    if _is_chromatic(colour) and white >= _READABLE_CONTRAST:
        hex_value = "FFFFFF"
    else:
        hex_value = "FFFFFF" if white >= _contrast("000000", colour) else "000000"
    return hex_value, _meta("fallback", 0, 0), f"{hex_value} is a contrast fallback"


def _surfaces(
    t: _Template, warnings: _Warnings
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Light and dark surfaces, each with the text and accent that live on it.

    Returns the surfaces and, per tone, the evidence behind its text colour, which the palette
    reuses for its own text role.
    """
    backgrounds: dict[str, _Tally] = {"light": _Tally(), "dark": _Tally()}
    text: dict[str, _Tally] = {"light": _Tally(), "dark": _Tally()}
    accent: dict[str, _Tally] = {"light": _Tally(), "dark": _Tally()}
    tone_of_part: dict[str, tuple[str, str]] = {}

    for container in t.usable_parts():
        background = t.background(container.part)
        if background is None:
            continue
        tone = "light" if _luminance(background) >= _LIGHT_LUMINANCE else "dark"
        tone_of_part[container.part] = (tone, background)
        backgrounds[tone].add(background, 1, container.part)

    for container in t.usable_parts():
        if container.part not in tone_of_part:
            continue
        tone, background = tone_of_part[container.part]
        for shape in container.shapes:
            if not t.on_slide(shape) or t.area_share(shape) >= _PANEL_AREA:
                continue
            fill = t.resolve_fill(shape.fill, container.part)
            if fill and fill[1] >= 0.3 and _is_chromatic(fill[0]):
                accent[tone].add(fill[0], 1, container.part)
        for shape, _, run in _runs(container):
            # Text inside a filled box sits on the box, not on the slide.
            if _has_own_fill(shape) or not run.color:
                continue
            if _contrast(run.color, background) >= _READABLE_CONTRAST:
                text[tone].add(run.color, len(run.text.strip()), container.part)

    total_parts = sum(b.total for b in backgrounds.values())
    surfaces: list[dict[str, Any]] = []
    text_meta: dict[str, dict[str, Any]] = {}
    for tone in ("light", "dark"):
        top = backgrounds[tone].top()
        if top is None:
            continue
        background = top[0]
        readable = text[tone].ranked()
        # Body text is a neutral. A chromatic colour that happens to read well is how a template
        # sets headings or links, and choosing it would paint every paragraph in the accent.
        neutral = [(h, w) for h, w in readable if not _is_chromatic(h)]
        pick = neutral[0] if neutral else (readable[0] if readable else None)
        if pick is not None:
            text_hex = pick[0]
            meta = _meta(
                "observed", pick[1], text[tone].total, text[tone].parts_of(pick[0]), k=_K_CHARS
            )
        else:
            text_hex, meta, note = _text_on(
                t, background, backgrounds[tone].parts_of(background)[0]
            )
            if note is not None:
                warnings.add(
                    "low-confidence",
                    f"surfaces.{tone}.text",
                    f"no run on the {tone} surface states a readable colour; {note}",
                )
        text_meta[tone] = meta
        accent_top = accent[tone].top()
        surfaces.append(
            {
                "tone": tone,
                "background": background,
                "text": text_hex,
                "accent": accent_top[0] if accent_top else None,
                "meta": _meta(
                    "observed",
                    backgrounds[tone].total,
                    total_parts,
                    backgrounds[tone].parts_of(background),
                ),
            }
        )

    tones = {s["tone"] for s in surfaces}
    for missing in ("light", "dark"):
        if surfaces and missing not in tones:
            warnings.add(
                "missing-surface",
                f"surfaces.{missing}",
                f"the template has no {missing} slides; a layout that needs one must derive it",
            )
    return surfaces, text_meta


# --------------------------------------------------------------------------------------- palette


def _hue_distance(a: str, b: str) -> float:
    distance = abs(_hue(a) - _hue(b)) % 360
    return min(distance, 360 - distance)


def _palette(
    t: _Template,
    surfaces: list[dict[str, Any]],
    text_meta: dict[str, dict[str, Any]],
    warnings: _Warnings,
) -> list[dict[str, Any]]:
    """Colours by role.

    Chromatic colours are ranked by how many parts use them in any role: as a fill, a stroke or
    text. A brand colour shows up everywhere and in every capacity, while a one-off highlight
    shows up once, and counting parts rather than shapes or characters keeps a single busy slide
    from outvoting the rest of the template.
    """
    neutral_fills = _Tally()
    presence = _Tally()
    chromatic_parts: set[str] = set()
    strokes = _Tally()
    text_all = _Tally()

    for container in t.all_parts():
        here: set[str] = set()
        for shape in container.shapes:
            if not t.on_slide(shape):
                continue
            fill = t.resolve_fill(shape.fill, container.part)
            if fill and fill[1] >= 0.3 and t.area_share(shape) < _PANEL_AREA:
                if _is_chromatic(fill[0]):
                    here.add(fill[0])
                else:
                    neutral_fills.add(fill[0], 1, container.part)
            if shape.stroke and shape.stroke.visible:
                resolved = t.resolve(shape.stroke.color, container.part)
                if resolved:
                    strokes.add(resolved[0], 1, container.part)
                    if _is_chromatic(resolved[0]):
                        here.add(resolved[0])
        for _, _, run in _runs(container):
            if run.color:
                text_all.add(run.color, len(run.text.strip()), container.part)
                if _is_chromatic(run.color):
                    here.add(run.color)
        for colour in here:
            presence.add(colour, 1, container.part)
        if here:
            chromatic_parts.add(container.part)

    palette: list[dict[str, Any]] = []
    used: set[str] = set()

    def add(role: str, hex_value: str, meta: dict[str, Any]) -> None:
        palette.append({"role": role, "hex": hex_value, "meta": meta})
        used.add(hex_value)

    # Background and text come from the dominant surface: that is where most content goes.
    dominant = max(surfaces, key=lambda s: (s["meta"]["count"], s["tone"])) if surfaces else None
    if dominant is not None:
        add("background", dominant["background"], dominant["meta"])
        add("text", dominant["text"], text_meta[dominant["tone"]])
    else:
        warnings.add("theme-missing", "palette.background", "no background could be resolved")

    colourful = len(chromatic_parts)
    ranked = presence.ranked()
    if ranked:
        accent, weight = ranked[0]
        add("accent", accent, _meta("observed", weight, colourful, presence.parts_of(accent)))
        for other, other_weight in ranked[1:]:
            if _hue_distance(other, accent) > 25 or abs(_hls(other)[1] - _hls(accent)[1]) > 0.2:
                add(
                    "accent-alt",
                    other,
                    _meta("observed", other_weight, colourful, presence.parts_of(other)),
                )
                break
        hex_value, meta, note = _text_on(t, accent, presence.parts_of(accent)[0])
        add("text-on-accent", hex_value, meta)
        if note is not None:
            warnings.add(
                "low-confidence",
                "palette.text-on-accent",
                f"no text is set on the accent anywhere in the template; {note}",
            )
    elif t.ir.masters:
        themed = t.resolve(ColorRef(scheme="accent1"), t.ir.masters[0].part)
        if themed:
            add("accent", themed[0], _meta("theme", 0, 0))
            warnings.add(
                "low-confidence",
                "palette.accent",
                "no chromatic colour is used anywhere; the theme's accent1 stands in",
            )

    neutral = [(h, w) for h, w in neutral_fills.ranked() if h not in used]
    if neutral:
        hex_value, weight = neutral[0]
        add(
            "surface",
            hex_value,
            _meta("observed", weight, neutral_fills.total, neutral_fills.parts_of(hex_value)),
        )

    if dominant is not None:
        readable = [
            (h, w)
            for h, w in text_all.ranked()
            if not _is_chromatic(h) and _contrast(h, dominant["background"]) >= _READABLE_CONTRAST
        ]
        population = sum(w for _, w in readable)
        # Muted text is quieter than body text. A colour with more contrast than the text is
        # emphasis, not muting, however often it appears.
        text_contrast = _contrast(dominant["text"], dominant["background"])
        muted = [
            (h, w)
            for h, w in readable
            if h not in used and _contrast(h, dominant["background"]) < text_contrast
        ]
        if muted:
            hex_value, weight = muted[0]
            add(
                "text-muted",
                hex_value,
                _meta("observed", weight, population, text_all.parts_of(hex_value), k=_K_CHARS),
            )

    line_top = strokes.top()
    if line_top is not None:
        add(
            "line",
            line_top[0],
            _meta("observed", line_top[1], strokes.total, strokes.parts_of(line_top[0])),
        )

    # Status colours only when the template actually uses one: inventing a green for a brand that
    # never shows one would be a design decision, not a measurement.
    for role, low, high in (("negative", 345, 15), ("positive", 95, 160)):
        for hex_value, weight in ranked:
            if hex_value in used:
                continue
            hue = _hue(hex_value)
            inside = (hue >= low or hue <= high) if low > high else (low <= hue <= high)
            if inside:
                add(
                    role,
                    hex_value,
                    _meta("observed", weight, colourful, presence.parts_of(hex_value)),
                )
                break

    return sorted(palette, key=lambda p: p["role"])


# ------------------------------------------------------------------------------------ typography


def _pick_font(
    wanted: str,
    declared: str,
    available: frozenset[str] | None,
    candidates: tuple[str, ...],
    token: str,
    warnings: _Warnings,
) -> tuple[str, bool]:
    """The font to use for a role, and whether it had to be substituted.

    With no list of available fonts the template's own choice stands. With one, a font the
    renderer cannot draw is replaced, and the replacement is stated as a warning rather than left
    for the export to discover.
    """
    if available is None or wanted.casefold() in available:
        return wanted, False
    for option in (declared, *candidates):
        if option and option.casefold() in available:
            warnings.add(
                "font-unavailable",
                token,
                f"{wanted} is not available to the renderer; {option} stands in for it",
            )
            return option, True
    warnings.add(
        "font-unavailable",
        token,
        f"{wanted} is not available and no fallback is either; it is kept as the template names it",
    )
    return wanted, False


def _families(
    t: _Template, available: frozenset[str] | None, warnings: _Warnings
) -> list[dict[str, Any]]:
    fonts = _Tally()
    for container in t.all_parts():
        for _, _, run in _runs(container):
            if run.font:
                fonts.add(run.font, len(run.text.strip()), container.part)

    declared = t.ir.theme_fonts.minor_latin or t.ir.theme_fonts.major_latin
    families: list[dict[str, Any]] = []
    regular = [(f, w) for f, w in fonts.ranked() if not _MONO.search(f)]
    mono = [(f, w) for f, w in fonts.ranked() if _MONO.search(f)]

    if regular:
        font, weight = regular[0]
        meta = _meta("observed", weight, fonts.total, fonts.parts_of(font), k=_K_CHARS)
        if declared and declared.casefold() != font.casefold():
            warnings.add(
                "observed-overrides-theme",
                "type.primary",
                f"the theme declares {declared}, the slides are set in {font}; the slides win",
            )
    elif declared:
        font, meta = declared, _meta("theme", 0, 0)
    else:
        font, meta = _FALLBACK_FONTS[0], _meta("fallback", 0, 0)
        warnings.add(
            "theme-missing",
            "type.primary",
            f"neither the slides nor the theme name a typeface; {font} is a fallback",
        )

    chosen, substituted = _pick_font(
        font, declared, available, _FALLBACK_FONTS, "type.primary", warnings
    )
    if substituted:
        meta = {**meta, "source": "fallback", "confidence": _CONFIDENCE_FALLBACK}
    families.append({"role": "primary", "font": chosen, "declared": declared, "meta": meta})

    if len(regular) > 1:
        second, weight = regular[1]
        if fonts.total and weight / fonts.total >= 0.05:
            families.append(
                {
                    "role": "secondary",
                    "font": second,
                    "declared": t.ir.theme_fonts.major_latin,
                    "meta": _meta(
                        "observed", weight, fonts.total, fonts.parts_of(second), k=_K_CHARS
                    ),
                }
            )
    if mono:
        font_mono, weight = mono[0]
        chosen_mono, sub = _pick_font(
            font_mono, "", available, _FALLBACK_MONO, "type.mono", warnings
        )
        meta_mono = _meta("observed", weight, fonts.total, fonts.parts_of(font_mono), k=_K_CHARS)
        if sub:
            meta_mono = {**meta_mono, "source": "fallback", "confidence": _CONFIDENCE_FALLBACK}
        families.append({"role": "mono", "font": chosen_mono, "declared": "", "meta": meta_mono})
    return families


def _type_scale(t: _Template, primary: str, warnings: _Warnings) -> list[dict[str, Any]]:
    """Sizes per role, from the placeholders that carry each role and from the text at large."""
    populations: dict[str, _Tally] = {
        name: _Tally() for name in ("title", "subtitle", "body", "all")
    }
    bold: dict[str, Counter[bool]] = defaultdict(Counter)
    spacing: dict[str, _Tally] = defaultdict(_Tally)

    for container in t.all_parts():
        for shape, paragraph, run in _runs(container):
            if run.size_pt is None:
                continue
            size = round(run.size_pt)
            chars = len(run.text.strip())
            kind = _placeholder_type(shape)
            role = (
                "title"
                if kind in _TITLE_TYPES
                else "subtitle"
                if kind in _SUBTITLE_TYPES
                else "body"
                if kind in _BODY_TYPES
                else None
            )
            populations["all"].add(size, chars, container.part)
            if role:
                populations[role].add(size, chars, container.part)
                bold[role][bool(run.bold)] += chars
                if paragraph.line_spacing:
                    spacing[role].add(paragraph.line_spacing, chars, container.part)
            bold[f"size:{size}"][bool(run.bold)] += chars
            if paragraph.line_spacing:
                spacing[f"size:{size}"].add(paragraph.line_spacing, chars, container.part)

    everything = populations["all"]
    if not everything.weight:
        warnings.add(
            "theme-missing",
            "type.body",
            "no run states a size; the type scale is a fallback and should not be trusted",
        )
        return [
            _style("title", primary, 32, True, 1.0, _meta("fallback", 0, 0)),
            _style("body", primary, 16, False, 1.1, _meta("fallback", 0, 0)),
        ]

    def choose(role: str) -> tuple[int, dict[str, Any]] | None:
        tally = populations[role]
        top = tally.top()
        if top is None:
            return None
        size, weight = top
        return size, _meta("observed", weight, tally.total, tally.parts_of(size), k=_K_CHARS)

    body = choose("body")
    if body is None:
        size, weight = everything.top()  # type: ignore[misc]
        body = (
            size,
            _meta("observed", weight, everything.total, everything.parts_of(size), k=_K_CHARS),
        )
    title = choose("title")
    if title is None:
        larger = [(s, w) for s, w in everything.ranked() if s > body[0] * 1.3]
        if larger:
            size, weight = larger[0]
            title = (
                size,
                _meta(
                    "observed",
                    weight,
                    sum(w for _, w in larger),
                    everything.parts_of(size),
                    k=_K_CHARS,
                ),
            )
        else:
            title = (round(body[0] * 1.8), _meta("fallback", 0, 0))
            warnings.add(
                "low-confidence",
                "type.title",
                "no title size was observed; it is derived from the body size",
            )

    def bold_of(key: str, default: bool) -> bool:
        counts = bold.get(key)
        if not counts:
            return default
        return counts[True] > counts[False]

    def spacing_of(key: str, default: float) -> float:
        top = spacing[key].top() if key in spacing else None
        return round(float(top[0]), 2) if top else default

    styles = [
        _style(
            "title", primary, title[0], bold_of("title", True), spacing_of("title", 0.9), title[1]
        ),
        _style("body", primary, body[0], bold_of("body", False), spacing_of("body", 1.1), body[1]),
    ]

    subtitle = choose("subtitle")
    if subtitle is not None:
        styles.append(
            _style(
                "subtitle",
                primary,
                subtitle[0],
                bold_of("subtitle", False),
                spacing_of("subtitle", 1.0),
                subtitle[1],
            )
        )

    # Secondary roles are each the most used size within their own band. Their share is measured
    # against that band, since competing with body text is not what makes a heading size right.
    def band(role: str, sizes: list[tuple[Any, float]], bold_default: bool) -> None:
        if not sizes:
            return
        size, weight = sizes[0]
        total = sum(w for _, w in sizes)
        styles.append(
            _style(
                role,
                primary,
                size,
                bold_of(f"size:{size}", bold_default),
                spacing_of(f"size:{size}", 1.0 if role != "kpi-value" else 0.9),
                _meta("observed", weight, total, everything.parts_of(size), k=_K_CHARS),
            )
        )

    ranked_sizes = everything.ranked()
    band("heading", [(s, w) for s, w in ranked_sizes if body[0] < s < title[0]], True)
    band("caption", [(s, w) for s, w in ranked_sizes if 6 <= s < body[0]], False)
    # A figure set huge once is a decoration, not a scale step: it needs a few characters of use.
    floor = max(5.0, everything.total * 0.002)
    band(
        "kpi-value",
        [(s, w) for s, w in ranked_sizes if s >= title[0] * 1.5 and w >= floor],
        True,
    )
    return sorted(styles, key=lambda s: -s["sizePt"])


def _style(
    role: str, font: str, size: float, bold: bool, line_spacing: float, meta: dict[str, Any]
) -> dict[str, Any]:
    return {
        "role": role,
        "font": font,
        "sizePt": float(size),
        "bold": bold,
        "italic": False,
        "lineSpacing": line_spacing,
        "colorRole": "text",
        "meta": meta,
    }


# ------------------------------------------------------------------------------------------ grid


def _mode(values: list[int]) -> tuple[int, int] | None:
    """Most common value after snapping, with how many agree. Ties go to the smaller value."""
    if not values:
        return None
    snapped = Counter(round(v / _MARGIN_STEP) * _MARGIN_STEP for v in values)
    value, count = sorted(snapped.items(), key=lambda item: (-item[1], item[0]))[0]
    return max(0, value), count


def _grid(t: _Template, body_pt: float, body_spacing: float, warnings: _Warnings) -> dict[str, Any]:
    width, height = t.ir.slide_cx, t.ir.slide_cy
    left: list[int] = []
    right: list[int] = []
    top: list[int] = []
    bottom: list[int] = []
    parts: set[str] = set()

    for container in (*t.ir.masters, *t.ir.layouts):
        for shape in container.shapes:
            kind = _placeholder_type(shape)
            if shape.box is None or kind not in (_TITLE_TYPES | _BODY_TYPES):
                continue
            box = shape.box
            if box.cx <= 0 or box.cy <= 0 or not t.on_slide(shape):
                continue
            left.append(box.x)
            # Only a wide placeholder says where the right margin is. A title box that spans
            # half the slide ends where its text is expected to end, not at the margin.
            if box.cx >= width * 0.5:
                right.append(width - (box.x + box.cx))
            parts.add(container.part)
            if kind in _TITLE_TYPES:
                top.append(box.y)
            else:
                bottom.append(height - (box.y + box.cy))

    margins = {
        name: _mode(values)
        for name, values in (("left", left), ("right", right), ("top", top), ("bottom", bottom))
    }
    fallback = {
        "left": round(width * 0.06),
        "right": round(width * 0.06),
        "top": round(height * 0.08),
        "bottom": round(height * 0.08),
    }
    resolved = {name: (m[0] if m else fallback[name]) for name, m in margins.items()}
    # Placeholders that stop well short of the right edge leave room for a picture; they do not
    # mark the outer margin. Outer margins are symmetric in every template examined, so the left
    # one, which placeholders do reach, stands in for the right.
    if resolved["right"] > max(2 * resolved["left"], resolved["left"] + width * 0.1):
        warnings.add(
            "low-confidence",
            "grid.marginRight",
            f"placeholders stop {resolved['right'] / EMU_PER_INCH:.2f} in short of the right "
            "edge, which is room for content rather than a margin; the right margin mirrors "
            "the left",
        )
        resolved["right"] = resolved["left"]
    missing = sorted(name for name, m in margins.items() if m is None)
    if missing:
        warnings.add(
            "low-confidence",
            "grid.margins",
            f"no placeholder fixes the {', '.join(missing)} margin; "
            "a proportional fallback is used",
        )
    warnings.add(
        "low-confidence",
        "grid.columns",
        "OOXML does not state columns or gutters; 12 columns with a 2 % gutter is a convention",
    )

    agree = sum(m[1] for m in margins.values() if m)
    population = len(left) + len(right) + len(top) + len(bottom)
    content = max(1, width - resolved["left"] - resolved["right"])
    line_height = round(body_pt * body_spacing * EMU_PER_PT)
    source = "observed" if population else "fallback"
    return {
        "slideCx": width,
        "slideCy": height,
        "marginLeft": resolved["left"],
        "marginRight": resolved["right"],
        "marginTop": resolved["top"],
        "marginBottom": resolved["bottom"],
        "columns": 12,
        "gutter": round(content * 0.02),
        "baseline": max(1, line_height),
        "meta": _meta(source, agree, population, parts),
    }


# ------------------------------------------------------------------------- strokes, radii, shadows


def _strokes(t: _Template, palette: list[dict[str, Any]]) -> list[dict[str, Any]]:
    tally = _Tally()
    for container in t.all_parts():
        for shape in container.shapes:
            stroke = shape.stroke
            if not stroke or not stroke.visible or not stroke.width_emu:
                continue
            resolved = t.resolve(stroke.color, container.part)
            if not resolved:
                continue
            width_pt = round(stroke.width_emu / EMU_PER_PT * 4) / 4
            tally.add((width_pt, resolved[0]), 1, container.part)

    roles = {entry["hex"]: entry["role"] for entry in palette}
    tokens: list[dict[str, Any]] = []
    for (width_pt, hex_value), weight in tally.ranked()[:4]:
        if tally.total and weight / tally.total < 0.05:
            continue
        tokens.append(
            {
                "widthPt": width_pt,
                "hex": hex_value,
                "colorRole": roles.get(hex_value),
                "meta": _meta(
                    "observed", weight, tally.total, tally.parts_of((width_pt, hex_value))
                ),
            }
        )
    return tokens


def _radii(t: _Template) -> list[dict[str, Any]]:
    """Corner radii clustered into at most three steps.

    Radii in a real template are near-misses of each other: 7.6 pt on one card, 8.6 pt on the
    next. Merging values within a quarter of each other recovers the steps the designer had in
    mind, and weighting by use picks the ones that matter.
    """
    values: list[tuple[float, str]] = []
    for container in t.all_parts():
        for shape in container.shapes:
            if shape.corner_radius_emu and t.on_slide(shape):
                values.append((shape.corner_radius_emu / EMU_PER_PT, container.part))
    if not values:
        return []

    clusters: list[list[tuple[float, str]]] = []
    for value, part in sorted(values):
        if clusters and value <= clusters[-1][0][0] * 1.25 + 0.5:
            clusters[-1].append((value, part))
        else:
            clusters.append([(value, part)])

    ranked = sorted(clusters, key=lambda c: (-len(c), c[0][0]))[:3]
    ranked.sort(key=lambda c: sum(v for v, _ in c) / len(c))
    names = {1: ["md"], 2: ["sm", "lg"], 3: ["sm", "md", "lg"]}[len(ranked)]
    total = len(values)
    tokens = []
    for name, cluster in zip(names, ranked, strict=True):
        radius = round(sorted(v for v, _ in cluster)[len(cluster) // 2], 1)
        tokens.append(
            {
                "name": name,
                "radiusPt": radius,
                "meta": _meta("observed", len(cluster), total, {p for _, p in cluster}),
            }
        )
    return tokens


def _shadows(t: _Template) -> dict[str, Any]:
    shapes = [s for c in t.all_parts() for s in c.shapes]
    count = sum(s.has_shadow for s in shapes)
    parts = {c.part for c in t.all_parts() for s in c.shapes if s.has_shadow}
    meta = _meta("observed", count or len(shapes), len(shapes), parts)
    # Absence of shadows is itself a measurement over every shape, so it is as trustworthy as
    # the count that supports it.
    return {"present": count > 0, "meta": meta}


# -------------------------------------------------------------------------------- protected zones


def _near_corner(t: _Template, box: Box) -> bool:
    """Whether a box sits in a corner band, which is where a brand puts its mark."""
    width, height = t.ir.slide_cx, t.ir.slide_cy
    near_x = box.x < width * 0.15 or box.x + box.cx > width * 0.85
    near_y = box.y < height * 0.15 or box.y + box.cy > height * 0.85
    return near_x and near_y


def _containment(a: Box, b: Box) -> float:
    """How much of the smaller box lies inside the other."""
    width = min(a.x + a.cx, b.x + b.cx) - max(a.x, b.x)
    height = min(a.y + a.cy, b.y + b.cy) - max(a.y, b.y)
    if width <= 0 or height <= 0:
        return 0.0
    smaller = min(a.cx * a.cy, b.cx * b.cy)
    return (width * height) / smaller if smaller else 0.0


def _union(a: Box, b: Box) -> Box:
    x, y = min(a.x, b.x), min(a.y, b.y)
    return Box(
        x=x,
        y=y,
        cx=max(a.x + a.cx, b.x + b.cx) - x,
        cy=max(a.y + a.cy, b.y + b.cy) - y,
    )


def _zones(t: _Template, warnings: _Warnings) -> list[dict[str, Any]]:
    """Logos, footers, page numbers and brand marks, found by where they sit, not what they are.

    A shape on the master is inherited by every layout, so it is chrome by construction. A shape
    that a good share of layouts place in the same spot is chrome by repetition. Pictures and
    vector groups both qualify: one template here draws its logo as a picture, another as a group
    of paths repeated on thirty layouts with nothing on the master at all. Full-bleed shapes are
    backgrounds and placeholders hold content, so both are left out.
    """
    width, height = t.ir.slide_cx, t.ir.slide_cy
    layout_count = max(1, len(t.ir.layouts))
    found: dict[tuple[Any, ...], dict[str, Any]] = {}

    for level, containers in (("master", t.ir.masters), ("layout", t.ir.layouts)):
        for container in containers:
            for shape in container.shapes:
                # A shape nested in a group is covered by the group.
                if shape.box is None or shape.path or not t.on_slide(shape):
                    continue
                kind = _placeholder_type(shape)
                area = t.area_share(shape)
                if kind in _FOOTER_TYPES:
                    role = "footer"
                elif kind in _NUMBER_TYPES:
                    role = "page-number"
                elif kind:
                    continue
                elif shape.kind == "picture" and area < 0.15:
                    role = "logo"
                elif shape.kind in ("group", "freeform") and area < 0.05:
                    role = "logo" if _near_corner(t, shape.box) else "decoration"
                else:
                    continue
                box = shape.box
                key = (
                    role,
                    shape.kind,
                    round(box.x / width * 100),
                    round(box.y / height * 100),
                    round(box.cx / width * 100),
                    round(box.cy / height * 100),
                    shape.media_part,
                )
                entry = found.setdefault(
                    key,
                    {
                        "role": role,
                        "kind": shape.kind,
                        "box": box,
                        "media": shape.media_part,
                        "levels": set(),
                        "parts": set(),
                    },
                )
                entry["levels"].add(level)
                entry["parts"].add(container.part)

    # Variants of one mark sit at one anchor: a short logo and a long one, or the same image
    # placed a few EMU apart. Anything mostly inside another zone of its role is that zone, and
    # the zone grows to cover both.
    merged: list[dict[str, Any]] = []
    for entry in sorted(
        found.values(),
        key=lambda e: (-len(e["parts"]), e["role"], e["box"].y, e["box"].x, e["media"]),
    ):
        for kept in merged:
            if kept["role"] == entry["role"] and _containment(kept["box"], entry["box"]) >= 0.6:
                kept["parts"] |= entry["parts"]
                kept["levels"] |= entry["levels"]
                kept["box"] = _union(kept["box"], entry["box"])
                break
        else:
            merged.append({**entry, "parts": set(entry["parts"]), "levels": set(entry["levels"])})

    zones: list[dict[str, Any]] = []
    for entry in merged:
        on_master = "master" in entry["levels"]
        layouts = len([p for p in entry["parts"] if p not in t.masters])
        placeholder = entry["role"] in ("footer", "page-number")
        # Repetition has to be real. A content picture does not sit in the same spot on three
        # layouts, so for pictures three is enough; a vector group can be a repeated content
        # structure, so it has to recur on a fifth of the layouts as well.
        if entry["kind"] == "picture":
            needed = min(3, max(2, layout_count))
        else:
            needed = max(3, layout_count * 0.2)
        if not (on_master or placeholder or layouts >= needed):
            continue
        count = layout_count if on_master else layouts
        box = entry["box"]
        zones.append(
            {
                "role": entry["role"],
                "box": {"x": box.x, "y": box.y, "cx": box.cx, "cy": box.cy},
                "mediaPart": entry["media"],
                "meta": _meta("observed", count, layout_count, entry["parts"]),
            }
        )

    if not zones:
        warnings.add(
            "low-confidence",
            "protectedZones",
            "no logo, footer or page number was found, so nothing is protected; a mark drawn "
            "differently from a picture or a repeated group would be missed",
        )
    return sorted(zones, key=lambda z: (z["role"], z["box"]["y"], z["box"]["x"], z["mediaPart"]))


# --------------------------------------------------------------------------------------- assembly


def _aspect(width: int, height: int) -> str:
    ratio = Fraction(width, height) if height else Fraction(0)
    return f"{ratio.numerator}:{ratio.denominator}"


def build_design_system(
    ir: TemplateIR,
    template_hash: str,
    available_fonts: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Derive the design system of a template from its IR.

    Args:
        ir: The parsed template.
        template_hash: Hash of the IR, so the pair can be checked downstream.
        available_fonts: Fonts the renderer can draw. When given, a font outside it is replaced
            by the theme's font or a common fallback, and the substitution is reported.

    Returns:
        A payload matching the shared ``DesignSystem`` contract.
    """
    warnings = _Warnings(items=[])
    available = (
        frozenset(f.casefold() for f in available_fonts) if available_fonts is not None else None
    )
    template = _Template(ir, warnings)

    if not ir.theme_colors:
        warnings.add("theme-missing", "palette", "the package carries no colour scheme")

    surfaces, text_meta = _surfaces(template, warnings)
    palette = _palette(template, surfaces, text_meta, warnings)
    families = _families(template, available, warnings)
    primary = families[0]["font"]
    scale = _type_scale(template, primary, warnings)
    body = next((s for s in scale if s["role"] == "body"), scale[-1])
    grid = _grid(template, body["sizePt"], body["lineSpacing"], warnings)

    for token, meta in (
        *((f"palette.{p['role']}", p["meta"]) for p in palette),
        *((f"type.{s['role']}", s["meta"]) for s in scale),
        *((f"type.{f['role']}", f["meta"]) for f in families),
    ):
        if meta["confidence"] < _LOW_CONFIDENCE:
            warnings.add(
                "low-confidence",
                token,
                f"confidence {meta['confidence']:.2f} from {meta['count']} observations "
                f"({meta['source']}); treat it as a guess",
            )

    strokes = _strokes(template, palette)
    radii = _radii(template)
    shadows = _shadows(template)
    zones = _zones(template, warnings)

    return {
        "schemaVersion": 1,
        "templateHash": template_hash,
        "aspect": _aspect(ir.slide_cx, ir.slide_cy),
        "palette": palette,
        "surfaces": surfaces,
        "typeFamilies": families,
        "typeScale": scale,
        "grid": grid,
        "strokes": strokes,
        "radii": radii,
        "shadows": shadows,
        "protectedZones": zones,
        "warnings": warnings.sorted(),
    }
