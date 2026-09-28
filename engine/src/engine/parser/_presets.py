"""Preset shape definitions, transcribed from ECMA-376 Part 1, ``presetShapeDefinitions.xml``.

Each preset is the program PowerPoint runs to draw a named shape: adjust values with their
defaults, guide formulas over the size of the shape, and the paths that trace the outline. They
are kept as data so ``_geometry`` evaluates presets and freeforms with one evaluator. Only presets
a slide can be expected to carry are listed; any other name is reported by the caller and drawn as
its box.
"""

from __future__ import annotations

from dataclasses import dataclass

Guide = tuple[str, str]
#: A pen command: its name and its arguments, each a number or the name of a guide.
Command = tuple[str, tuple[str, ...]]


@dataclass(frozen=True)
class PresetPath:
    """One ``a:path``: its commands, its own coordinate space and whether it is filled/stroked.

    A width or height of zero means the path is drawn in the shape's own space.
    """

    commands: tuple[Command, ...]
    width: float = 0.0
    height: float = 0.0
    filled: bool = True
    stroked: bool = True


@dataclass(frozen=True)
class Preset:
    adjustments: tuple[Guide, ...]
    guides: tuple[Guide, ...]
    paths: tuple[PresetPath, ...]


def _m(x: str, y: str) -> Command:
    return ("moveTo", (x, y))


def _l(x: str, y: str) -> Command:
    return ("lnTo", (x, y))


def _arc(w_r: str, h_r: str, start: str, sweep: str) -> Command:
    return ("arcTo", (w_r, h_r, start, sweep))


def _c(x1: str, y1: str, x2: str, y2: str, x3: str, y3: str) -> Command:
    return ("cubicBezTo", (x1, y1, x2, y2, x3, y3))


_Z: Command = ("close", ())


def _polygon(*points: tuple[str, str]) -> tuple[PresetPath, ...]:
    first, *rest = points
    return (PresetPath(commands=(_m(*first), *(_l(*p) for p in rest), _Z)),)


def _guides(text: str) -> tuple[Guide, ...]:
    """Guides written one per line as ``name = formula``, the way the specification lists them."""
    guides: list[Guide] = []
    for line in text.strip().splitlines():
        if not line.strip():
            continue
        name, formula = line.split("=", 1)
        guides.append((name.strip(), formula.strip()))
    return tuple(guides)


_PENTAGON_GUIDES = """
swd2 = */ wd2 hf 100000
shd2 = */ hd2 vf 100000
svc = */ vc vf 100000
dx1 = cos swd2 1080000
dx2 = cos swd2 18360000
dy1 = sin shd2 1080000
dy2 = sin shd2 18360000
x1 = +- hc 0 dx1
x2 = +- hc 0 dx2
x3 = +- hc dx2 0
x4 = +- hc dx1 0
y1 = +- svc 0 dy1
y2 = +- svc 0 dy2
"""

PRESETS: dict[str, Preset] = {
    "triangle": Preset(
        adjustments=(("adj", "val 50000"),),
        guides=_guides("""
            a = pin 0 adj 100000
            x1 = */ w a 200000
            x2 = */ w a 100000
            x3 = +- x1 wd2 0
        """),
        paths=_polygon(("l", "b"), ("x2", "t"), ("r", "b")),
    ),
    "rtTriangle": Preset(
        adjustments=(),
        guides=(),
        paths=_polygon(("l", "b"), ("l", "t"), ("r", "b")),
    ),
    "parallelogram": Preset(
        adjustments=(("adj", "val 25000"),),
        guides=_guides("""
            maxAdj = */ 100000 w ss
            a = pin 0 adj maxAdj
            x1 = */ ss a 200000
            x2 = */ ss a 100000
            x6 = +- r 0 x2
            x5 = +- r 0 x1
        """),
        paths=_polygon(("l", "b"), ("x2", "t"), ("r", "t"), ("x6", "b")),
    ),
    "trapezoid": Preset(
        adjustments=(("adj", "val 25000"),),
        guides=_guides("""
            maxAdj = */ 50000 w ss
            a = pin 0 adj maxAdj
            x1 = */ ss a 200000
            x2 = */ ss a 100000
            x3 = +- r 0 x2
            x4 = +- r 0 x1
        """),
        paths=_polygon(("l", "b"), ("x2", "t"), ("x3", "t"), ("r", "b")),
    ),
    "pentagon": Preset(
        adjustments=(("hf", "val 105146"), ("vf", "val 110557")),
        guides=_guides(_PENTAGON_GUIDES),
        paths=_polygon(("x1", "y1"), ("hc", "t"), ("x4", "y1"), ("x3", "y2"), ("x2", "y2")),
    ),
    "hexagon": Preset(
        adjustments=(("adj", "val 25000"), ("vf", "val 115470")),
        guides=_guides("""
            maxAdj = */ 50000 w ss
            a = pin 0 adj maxAdj
            shd2 = */ hd2 vf 100000
            x1 = */ ss a 100000
            x2 = +- r 0 x1
            dy1 = sin shd2 3600000
            y1 = +- vc 0 dy1
            y2 = +- vc dy1 0
        """),
        paths=_polygon(
            ("l", "vc"), ("x1", "y1"), ("x2", "y1"), ("r", "vc"), ("x2", "y2"), ("x1", "y2")
        ),
    ),
    "octagon": Preset(
        adjustments=(("adj", "val 29289"),),
        guides=_guides("""
            a = pin 0 adj 50000
            x1 = */ ss a 100000
            x2 = +- r 0 x1
            y2 = +- b 0 x1
        """),
        paths=_polygon(
            ("l", "x1"),
            ("x1", "t"),
            ("x2", "t"),
            ("r", "x1"),
            ("r", "y2"),
            ("x2", "b"),
            ("x1", "b"),
            ("l", "y2"),
        ),
    ),
    "chevron": Preset(
        adjustments=(("adj", "val 50000"),),
        guides=_guides("""
            maxAdj = */ 100000 w ss
            a = pin 0 adj maxAdj
            x1 = */ ss a 100000
            x2 = +- r 0 x1
        """),
        paths=_polygon(("l", "t"), ("x2", "t"), ("r", "vc"), ("x2", "b"), ("l", "b"), ("x1", "vc")),
    ),
    "homePlate": Preset(
        adjustments=(("adj", "val 50000"),),
        guides=_guides("""
            maxAdj = */ 100000 w ss
            a = pin 0 adj maxAdj
            dx1 = */ ss a 100000
            x1 = +- r 0 dx1
        """),
        paths=_polygon(("l", "t"), ("x1", "t"), ("r", "vc"), ("x1", "b"), ("l", "b")),
    ),
    "rightArrow": Preset(
        adjustments=(("adj1", "val 50000"), ("adj2", "val 50000")),
        guides=_guides("""
            maxAdj2 = */ 100000 w ss
            a1 = pin 0 adj1 100000
            a2 = pin 0 adj2 maxAdj2
            dx1 = */ ss a2 100000
            x1 = +- r 0 dx1
            dy1 = */ h a1 200000
            y1 = +- vc 0 dy1
            y2 = +- vc dy1 0
        """),
        paths=_polygon(
            ("l", "y1"),
            ("x1", "y1"),
            ("x1", "t"),
            ("r", "vc"),
            ("x1", "b"),
            ("x1", "y2"),
            ("l", "y2"),
        ),
    ),
    "leftArrow": Preset(
        adjustments=(("adj1", "val 50000"), ("adj2", "val 50000")),
        guides=_guides("""
            maxAdj2 = */ 100000 w ss
            a1 = pin 0 adj1 100000
            a2 = pin 0 adj2 maxAdj2
            dx2 = */ ss a2 100000
            x2 = +- l dx2 0
            dy1 = */ h a1 200000
            y1 = +- vc 0 dy1
            y2 = +- vc dy1 0
        """),
        paths=_polygon(
            ("l", "vc"),
            ("x2", "t"),
            ("x2", "y1"),
            ("r", "y1"),
            ("r", "y2"),
            ("x2", "y2"),
            ("x2", "b"),
        ),
    ),
    "upArrow": Preset(
        adjustments=(("adj1", "val 50000"), ("adj2", "val 50000")),
        guides=_guides("""
            maxAdj2 = */ 100000 h ss
            a1 = pin 0 adj1 100000
            a2 = pin 0 adj2 maxAdj2
            dy2 = */ ss a2 100000
            y2 = +- t dy2 0
            dx1 = */ w a1 200000
            x1 = +- hc 0 dx1
            x2 = +- hc dx1 0
        """),
        paths=_polygon(
            ("l", "y2"),
            ("hc", "t"),
            ("r", "y2"),
            ("x2", "y2"),
            ("x2", "b"),
            ("x1", "b"),
            ("x1", "y2"),
        ),
    ),
    "downArrow": Preset(
        adjustments=(("adj1", "val 50000"), ("adj2", "val 50000")),
        guides=_guides("""
            maxAdj2 = */ 100000 h ss
            a1 = pin 0 adj1 100000
            a2 = pin 0 adj2 maxAdj2
            dy1 = */ ss a2 100000
            y1 = +- b 0 dy1
            dx1 = */ w a1 200000
            x1 = +- hc 0 dx1
            x2 = +- hc dx1 0
        """),
        paths=_polygon(
            ("l", "y1"),
            ("x1", "y1"),
            ("x1", "t"),
            ("x2", "t"),
            ("x2", "y1"),
            ("r", "y1"),
            ("hc", "b"),
        ),
    ),
    "leftRightArrow": Preset(
        adjustments=(("adj1", "val 50000"), ("adj2", "val 50000")),
        guides=_guides("""
            maxAdj2 = */ 50000 w ss
            a1 = pin 0 adj1 100000
            a2 = pin 0 adj2 maxAdj2
            x2 = */ ss a2 100000
            x3 = +- r 0 x2
            dy = */ h a1 200000
            y1 = +- vc 0 dy
            y2 = +- vc dy 0
        """),
        paths=_polygon(
            ("l", "vc"),
            ("x2", "t"),
            ("x2", "y1"),
            ("x3", "y1"),
            ("x3", "t"),
            ("r", "vc"),
            ("x3", "b"),
            ("x3", "y2"),
            ("x2", "y2"),
            ("x2", "b"),
        ),
    ),
    "snip1Rect": Preset(
        adjustments=(("adj", "val 16667"),),
        guides=_guides("""
            a = pin 0 adj 50000
            dx1 = */ ss a 100000
            x1 = +- r 0 dx1
        """),
        paths=_polygon(("l", "t"), ("x1", "t"), ("r", "dx1"), ("r", "b"), ("l", "b")),
    ),
    "round1Rect": Preset(
        adjustments=(("adj", "val 16667"),),
        guides=_guides("""
            a = pin 0 adj 50000
            dx1 = */ ss a 100000
            x1 = +- r 0 dx1
        """),
        paths=(
            PresetPath(
                commands=(
                    _m("l", "t"),
                    _l("x1", "t"),
                    _arc("dx1", "dx1", "3cd4", "cd4"),
                    _l("r", "b"),
                    _l("l", "b"),
                    _Z,
                )
            ),
        ),
    ),
    "round2SameRect": Preset(
        adjustments=(("adj1", "val 16667"), ("adj2", "val 0")),
        guides=_guides("""
            a1 = pin 0 adj1 50000
            a2 = pin 0 adj2 50000
            tx1 = */ ss a1 100000
            tx2 = +- r 0 tx1
            bx1 = */ ss a2 100000
            bx2 = +- r 0 bx1
            by1 = +- b 0 bx1
        """),
        paths=(
            PresetPath(
                commands=(
                    _m("tx1", "t"),
                    _l("tx2", "t"),
                    _arc("tx1", "tx1", "3cd4", "cd4"),
                    _l("r", "by1"),
                    _arc("bx1", "bx1", "0", "cd4"),
                    _l("bx1", "b"),
                    _arc("bx1", "bx1", "cd4", "cd4"),
                    _l("l", "tx1"),
                    _arc("tx1", "tx1", "cd2", "cd4"),
                    _Z,
                )
            ),
        ),
    ),
    "plus": Preset(
        adjustments=(("adj", "val 25000"),),
        guides=_guides("""
            a = pin 0 adj 50000
            x1 = */ ss a 100000
            x2 = +- r 0 x1
            y2 = +- b 0 x1
        """),
        paths=_polygon(
            ("l", "x1"),
            ("x1", "x1"),
            ("x1", "t"),
            ("x2", "t"),
            ("x2", "x1"),
            ("r", "x1"),
            ("r", "y2"),
            ("x2", "y2"),
            ("x2", "b"),
            ("x1", "b"),
            ("x1", "y2"),
            ("l", "y2"),
        ),
    ),
    "star5": Preset(
        adjustments=(("adj", "val 19098"), ("hf", "val 105146"), ("vf", "val 110557")),
        guides=_guides(
            "a = pin 0 adj 50000\n"
            + _PENTAGON_GUIDES
            + """
            iwd2 = */ swd2 a 50000
            ihd2 = */ shd2 a 50000
            sdx1 = cos iwd2 20520000
            sdx2 = cos iwd2 3240000
            sdy1 = sin ihd2 3240000
            sdy2 = sin ihd2 20520000
            sx1 = +- hc 0 sdx1
            sx2 = +- hc 0 sdx2
            sx3 = +- hc sdx2 0
            sx4 = +- hc sdx1 0
            sy1 = +- svc 0 sdy1
            sy2 = +- svc 0 sdy2
            sy3 = +- svc ihd2 0
            """
        ),
        paths=_polygon(
            ("x1", "y1"),
            ("sx2", "sy1"),
            ("hc", "t"),
            ("sx3", "sy1"),
            ("x4", "y1"),
            ("sx4", "sy2"),
            ("x3", "y2"),
            ("hc", "sy3"),
            ("x2", "y2"),
            ("sx1", "sy2"),
        ),
    ),
    "flowChartProcess": Preset(
        adjustments=(),
        guides=(),
        paths=(
            PresetPath(
                commands=(_m("0", "0"), _l("1", "0"), _l("1", "1"), _l("0", "1"), _Z),
                width=1,
                height=1,
            ),
        ),
    ),
    "flowChartDecision": Preset(
        adjustments=(),
        guides=(),
        paths=(
            PresetPath(
                commands=(_m("0", "1"), _l("1", "0"), _l("2", "1"), _l("1", "2"), _Z),
                width=2,
                height=2,
            ),
        ),
    ),
    "bentConnector2": Preset(
        adjustments=(),
        guides=(),
        paths=(PresetPath(commands=(_m("l", "t"), _l("r", "t"), _l("r", "b")), filled=False),),
    ),
    "bentConnector3": Preset(
        adjustments=(("adj1", "val 50000"),),
        guides=_guides("x1 = */ w adj1 100000"),
        paths=(
            PresetPath(
                commands=(_m("l", "t"), _l("x1", "t"), _l("x1", "b"), _l("r", "b")),
                filled=False,
            ),
        ),
    ),
    "curvedConnector3": Preset(
        adjustments=(("adj1", "val 50000"),),
        guides=_guides("""
            x2 = */ w adj1 100000
            x1 = +/ l x2 2
            x3 = +/ r x2 2
            y3 = */ h 3 4
        """),
        paths=(
            PresetPath(
                commands=(
                    _m("l", "t"),
                    _c("x1", "t", "x2", "hd4", "x2", "vc"),
                    _c("x2", "y3", "x3", "b", "r", "b"),
                ),
                filled=False,
            ),
        ),
    ),
}
