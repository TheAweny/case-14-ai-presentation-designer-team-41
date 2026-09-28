"""DrawingML geometry as SVG path data: guide formulas, freeforms and preset shapes.

A shape outline in OOXML is a small program. Guides (``a:gd``) are formulas over the size of the
shape, its adjust values and each other; paths (``a:path``) are pen commands whose coordinates
name guides or state numbers. Preset shapes are the same programs, published once in ECMA-376
(``presetShapeDefinitions.xml``) and referred to by name. This module runs those programs and
writes the outline as SVG path data in the space of the shape's own size, so a renderer only has
to stretch it over the box.

Nothing here knows about any particular template: every number comes from the file or from the
published definitions in ``_presets``.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from engine.parser._presets import PRESETS, Command, PresetPath

_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"

#: Angles in DrawingML are in 60 000ths of a degree.
_ANGLE_UNIT = 60000.0

#: Named angles every geometry may refer to.
_ANGLES = {
    "cd2": 10800000.0,
    "cd4": 5400000.0,
    "cd8": 2700000.0,
    "3cd4": 16200000.0,
    "3cd8": 8100000.0,
    "5cd8": 13500000.0,
    "7cd8": 18900000.0,
}


def builtin_guides(width: float, height: float) -> dict[str, float]:
    """Values every guide formula may use without defining them: the shape's size and its parts."""
    short, long_side = min(width, height), max(width, height)
    values = {
        "w": width,
        "h": height,
        "l": 0.0,
        "t": 0.0,
        "r": width,
        "b": height,
        "hc": width / 2,
        "vc": height / 2,
        "ss": short,
        "ls": long_side,
        **_ANGLES,
    }
    for divisor in (2, 3, 4, 5, 6, 8, 10, 12, 16, 32):
        values[f"wd{divisor}"] = width / divisor
        values[f"hd{divisor}"] = height / divisor
        values[f"ssd{divisor}"] = short / divisor
    return values


def _radians(angle: float) -> float:
    return math.radians(angle / _ANGLE_UNIT)


def _degrees_60k(radians: float) -> float:
    return math.degrees(radians) * _ANGLE_UNIT


def _value(token: str, env: Mapping[str, float]) -> float:
    if token in env:
        return env[token]
    try:
        return float(token)
    except ValueError as error:
        raise ValueError(f"unknown guide {token!r}") from error


def evaluate(formula: str, env: Mapping[str, float]) -> float:
    """Value of one guide formula (ECMA-376 20.1.9.11) against the guides known so far.

    Raises:
        ValueError: The formula names an operator or a guide that does not exist.
    """
    parts = formula.split()
    if not parts:
        raise ValueError("empty guide formula")
    op, args = parts[0], [_value(token, env) for token in parts[1:]]

    def arg(index: int) -> float:
        return args[index] if index < len(args) else 0.0

    x, y, z = arg(0), arg(1), arg(2)
    if op == "val":
        return x
    if op == "*/":
        return x * y / z if z else 0.0
    if op == "+-":
        return x + y - z
    if op == "+/":
        return (x + y) / z if z else 0.0
    if op == "?:":
        return y if x > 0 else z
    if op == "abs":
        return abs(x)
    if op == "at2":
        return _degrees_60k(math.atan2(y, x))
    if op == "cat2":
        return x * math.cos(math.atan2(z, y))
    if op == "sat2":
        return x * math.sin(math.atan2(z, y))
    if op == "cos":
        return x * math.cos(_radians(y))
    if op == "sin":
        return x * math.sin(_radians(y))
    if op == "tan":
        return x * math.tan(_radians(y))
    if op == "max":
        return max(x, y)
    if op == "min":
        return min(x, y)
    if op == "mod":
        return math.sqrt(x * x + y * y + z * z)
    if op == "pin":
        return x if y < x else z if y > z else y
    if op == "sqrt":
        return math.sqrt(x) if x > 0 else 0.0
    raise ValueError(f"unknown guide operator {op!r}")


def guide_values(
    width: float,
    height: float,
    adjustments: Iterable[tuple[str, str]],
    guides: Iterable[tuple[str, str]],
) -> dict[str, float]:
    """Every guide of a geometry, adjust values first, each formula seeing the ones before it.

    A name defined twice keeps its last value, which is how PowerPoint reads the repeated
    ``connsite`` guides some editors write.
    """
    env = builtin_guides(width, height)
    for name, formula in (*adjustments, *guides):
        env[name] = evaluate(formula, env)
    return env


def _fmt(value: float) -> str:
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def _parametric(angle: float, rx: float, ry: float) -> float:
    """Parameter of the point an arc angle names on an ellipse.

    DrawingML angles are visual: the direction of the ray from the centre. On a circle that is the
    parameter itself; on an ellipse it has to be converted, or arcs of stretched shapes start and
    end in the wrong place.
    """
    theta = _radians(angle)
    return math.atan2(rx * math.sin(theta), ry * math.cos(theta))


def _arc(
    current: tuple[float, float],
    rx: float,
    ry: float,
    start: float,
    sweep: float,
    scale: tuple[float, float],
) -> tuple[list[str], tuple[float, float]]:
    """SVG for ``a:arcTo`` from the current point, and where the pen ends up (in path units)."""
    sx, sy = scale
    if sweep == 0:
        return [], current
    t1 = _parametric(start, rx, ry)
    cx = current[0] - rx * math.cos(t1)
    cy = current[1] - ry * math.sin(t1)
    commands: list[str] = []
    # An arc of a full turn or more has no single SVG form; draw it in pieces of at most half a
    # turn, which also keeps the large-arc flag unambiguous.
    pieces = max(1, math.ceil(abs(sweep) / (_ANGLES["cd2"])))
    step = sweep / pieces
    angle = start
    end = current
    for _ in range(pieces):
        angle += step
        t2 = _parametric(angle, rx, ry)
        end = (cx + rx * math.cos(t2), cy + ry * math.sin(t2))
        if rx == 0 or ry == 0:
            commands.append(f"L {_fmt(end[0] * sx)} {_fmt(end[1] * sy)}")
            continue
        large = 1 if abs(step) > _ANGLES["cd2"] else 0
        sweep_flag = 1 if step > 0 else 0
        commands.append(
            f"A {_fmt(rx * sx)} {_fmt(ry * sy)} 0 {large} {sweep_flag} "
            f"{_fmt(end[0] * sx)} {_fmt(end[1] * sy)}"
        )
    return commands, end


def path_data(
    commands: Sequence[Command], env: Mapping[str, float], scale: tuple[float, float]
) -> str:
    """SVG path data for one DrawingML path, scaled from path units into the shape's space."""
    sx, sy = scale
    out: list[str] = []
    current = (0.0, 0.0)
    subpath_start = current

    def point(x: str, y: str) -> tuple[float, float]:
        return _value(x, env), _value(y, env)

    def emit(letter: str, points: Sequence[tuple[float, float]]) -> None:
        coords = " ".join(f"{_fmt(px * sx)} {_fmt(py * sy)}" for px, py in points)
        out.append(f"{letter} {coords}")

    for name, args in commands:
        if name == "moveTo":
            current = subpath_start = point(args[0], args[1])
            emit("M", [current])
        elif name == "lnTo":
            current = point(args[0], args[1])
            emit("L", [current])
        elif name == "cubicBezTo":
            points = [point(args[i], args[i + 1]) for i in (0, 2, 4)]
            emit("C", points)
            current = points[-1]
        elif name == "quadBezTo":
            points = [point(args[i], args[i + 1]) for i in (0, 2)]
            emit("Q", points)
            current = points[-1]
        elif name == "arcTo":
            rx, ry = abs(_value(args[0], env)), abs(_value(args[1], env))
            pieces, current = _arc(
                current, rx, ry, _value(args[2], env), _value(args[3], env), scale
            )
            out.extend(pieces)
        elif name == "close":
            out.append("Z")
            current = subpath_start
    return " ".join(out)


def _geometry(
    width: int,
    height: int,
    env: Mapping[str, float],
    paths: Iterable[PresetPath],
) -> dict[str, Any] | None:
    space_w, space_h = max(width, 1), max(height, 1)
    drawn: list[dict[str, Any]] = []
    for path in paths:
        scale_x = space_w / path.width if path.width else 1.0
        scale_y = space_h / path.height if path.height else 1.0
        data = path_data(path.commands, env, (scale_x, scale_y))
        if data:
            drawn.append({"d": data, "filled": path.filled, "stroked": path.stroked})
    if not drawn:
        return None
    return {"width": space_w, "height": space_h, "paths": drawn}


def _flag(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value not in ("0", "false", "none")


def _commands_of(path: Any) -> list[Command]:
    commands: list[Command] = []
    for child in path:
        name = str(child.tag).removeprefix(_A)
        if name == "close":
            commands.append((name, ()))
            continue
        if name == "arcTo":
            commands.append(
                (
                    name,
                    (
                        child.get("wR", "0"),
                        child.get("hR", "0"),
                        child.get("stAng", "0"),
                        child.get("swAng", "0"),
                    ),
                )
            )
            continue
        coords: list[str] = []
        for pt in child.findall(f"{_A}pt"):
            coords.extend((pt.get("x", "0"), pt.get("y", "0")))
        commands.append((name, tuple(coords)))
    return commands


def _formulas(parent: Any) -> list[tuple[str, str]]:
    if parent is None:
        return []
    return [(gd.get("name", ""), gd.get("fmla", "val 0")) for gd in parent.findall(f"{_A}gd")]


def custom_geometry(cust_geom: Any, width: int, height: int) -> dict[str, Any] | None:
    """Outline of an ``a:custGeom`` in a ``width`` by ``height`` space; None if it draws nothing.

    Raises:
        ValueError: A guide formula cannot be evaluated.
    """
    env = guide_values(
        width,
        height,
        _formulas(cust_geom.find(f"{_A}avLst")),
        _formulas(cust_geom.find(f"{_A}gdLst")),
    )
    paths = [
        PresetPath(
            commands=tuple(_commands_of(path)),
            width=float(path.get("w", "0") or 0),
            height=float(path.get("h", "0") or 0),
            filled=path.get("fill", "norm") != "none",
            stroked=_flag(path.get("stroke"), True),
        )
        for path in cust_geom.findall(f"{_A}pathLst/{_A}path")
    ]
    return _geometry(width, height, env, paths)


def preset_geometry(
    name: str, stated: Iterable[tuple[str, str]], width: int, height: int
) -> dict[str, Any] | None:
    """Outline of a preset shape with its stated adjust values, or None for an unknown preset.

    Raises:
        ValueError: A stated adjust value cannot be evaluated.
    """
    preset = PRESETS.get(name)
    if preset is None:
        return None
    adjustments = dict(preset.adjustments)
    adjustments.update(dict(stated))
    env = guide_values(width, height, adjustments.items(), preset.guides)
    return _geometry(width, height, env, preset.paths)


def adjustments_of(prst_geom: Any) -> list[tuple[str, str]]:
    """Adjust values a ``a:prstGeom`` states for itself, as (name, formula)."""
    return _formulas(prst_geom.find(f"{_A}avLst"))
