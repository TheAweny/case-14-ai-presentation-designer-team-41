"""The deterministic checks, one function per registered check id.

Each rule takes one slide and returns the findings it raises on it, already in the shape of the
AuditFinding contract. A rule proposes a patch whenever the fix can be computed without a model:
moving a box back into the safe area, stepping a size down the scale, swapping a colour for the
nearest palette role. What needs new words is marked `assisted` and left to an agent.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from itertools import combinations
from typing import Any

from engine.checks._geometry import (
    EMU_PER_PT,
    Rect,
    Template,
    contrast_ratio,
    distortion,
    element_texts,
    fraction_covered,
    hex_distance,
    is_content,
    nearest,
    paragraph_text,
    paragraphs_of,
    share_groups,
    text_height,
    words,
)
from engine.checks.registry import CheckDefinition


@dataclass(slots=True)
class AuditContext:
    """What every rule may read besides the slide itself."""

    template: Template
    patterns: dict[str, dict[str, Any]] | None
    media_sizes: dict[str, dict[str, int]]
    deck: list[dict[str, Any]] = field(default_factory=list[dict[str, Any]])
    #: Template sample text by slide id and element id; empty when the caller has none.
    samples: dict[str, dict[str, str]] = field(default_factory=dict[str, dict[str, str]])
    #: The current year and the years the source content names, for telling a stale year.
    year: int = 0
    known_years: frozenset[int] = frozenset()
    params: dict[str, dict[str, Any]] = field(default_factory=dict[str, dict[str, Any]])


Finding = dict[str, Any]
Rule = Callable[[CheckDefinition, dict[str, Any], AuditContext], list[Finding]]


class _Emitter:
    """Builds findings for one check on one slide, with ids stable for a given input."""

    def __init__(self, check: CheckDefinition, slide: dict[str, Any]) -> None:
        self.check, self.slide = check, slide
        self.findings: list[Finding] = []

    def add(
        self,
        *,
        title: str,
        detail: str,
        element: dict[str, Any] | None = None,
        box: dict[str, int] | None = None,
        measured: str = "",
        expected: str = "",
        quote: str = "",
        ops: list[dict[str, Any]] | None = None,
        rationale: str = "",
        assisted: bool = False,
        confidence: float = 1.0,
        severity: str | None = None,
    ) -> None:
        slide, check = self.slide, self.check
        element_id = element["elementId"] if element else None
        finding_id = (
            f"{check.id}:{slide['variant']}:{slide['slideId']}:"
            f"{element_id or 'slide'}:{len(self.findings)}"
        )
        patch = None
        if ops:
            patch = {
                "patchId": f"patch:{finding_id}",
                "findingId": finding_id,
                "slideId": slide["slideId"],
                "variant": slide["variant"],
                "ops": ops,
                "rationale": rationale or title,
                "touchesCopy": False,
            }
        self.findings.append(
            {
                "schemaVersion": 1,
                "findingId": finding_id,
                "checkId": check.id,
                "origin": "deterministic",
                "severity": severity or check.severity,
                "confidence": confidence,
                "title": title,
                "detail": detail,
                "target": {
                    "slideId": slide["slideId"],
                    "variant": slide["variant"],
                    "elementId": element_id,
                    "box": box if box is not None else (element["box"] if element else None),
                },
                "evidence": {
                    "measured": measured,
                    "expected": expected,
                    "quote": quote[:280],
                    "sources": [],
                    "screenshot": "",
                },
                "fixability": "auto" if patch else ("assisted" if assisted else "manual"),
                "proposedPatch": patch,
            }
        )


def _slide_rect(slide: dict[str, Any]) -> Rect:
    return Rect(0, 0, int(slide["slideCx"]), int(slide["slideCy"]))


def _clamp_into(rect: Rect, area: Rect) -> Rect | None:
    """The same box moved inside an area, or None when it is larger than the area."""
    if rect.cx > area.cx or rect.cy > area.cy:
        return None
    x = min(max(rect.x, area.x), area.right - rect.cx)
    y = min(max(rect.y, area.y), area.bottom - rect.cy)
    return Rect(x, y, rect.cx, rect.cy)


def _move(element: dict[str, Any], rect: Rect) -> list[dict[str, Any]]:
    return [{"op": "move", "elementId": element["elementId"], "box": rect.as_box()}]


def _pct(value: float) -> str:
    return f"{value * 100:.0f}%"


def _pt(emu: float) -> str:
    return f"{emu / EMU_PER_PT:.0f} pt"


# Layout --------------------------------------------------------------------------------------


def _outside(rect: Rect, slide: Rect, tolerance: float) -> list[str]:
    sides = []
    if rect.x < slide.x - tolerance:
        sides.append("слева")
    if rect.y < slide.y - tolerance:
        sides.append("сверху")
    if rect.right > slide.right + tolerance:
        sides.append("справа")
    if rect.bottom > slide.bottom + tolerance:
        sides.append("снизу")
    return sides


def _is_bleed_decoration(element: dict[str, Any]) -> bool:
    return element["kind"] == "decor" and not element.get("paragraphs")


def slide_bounds(check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext) -> list[Finding]:
    out = _Emitter(check, slide)
    area = _slide_rect(slide)
    tolerance = ctx.params[check.id]["toleranceShare"] * area.cx
    for element in slide["elements"]:
        if element["kind"] == "text" or _is_bleed_decoration(element):
            continue
        if element["role"] == "decoration":
            continue
        rect = Rect.of(element["box"])
        sides = _outside(rect, area, tolerance)
        if not sides:
            continue
        target = _clamp_into(rect, area)
        out.add(
            title="Элемент выходит за границы слайда",
            detail=f"Блок выступает за край слайда: {', '.join(sides)}. Эта часть не будет видна.",
            element=element,
            measured=f"x={rect.x}, y={rect.y}, cx={rect.cx}, cy={rect.cy}",
            expected=f"внутри 0..{area.cx} × 0..{area.cy} EMU",
            ops=_move(element, target) if target else None,
            rationale="Вернуть блок внутрь слайда",
        )
    return out.findings


def text_clipped(check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext) -> list[Finding]:
    out = _Emitter(check, slide)
    area = _slide_rect(slide)
    tolerance = ctx.params[check.id]["toleranceShare"] * area.cx
    for element in slide["elements"]:
        if not paragraphs_of(element) or element["role"] == "decoration":
            continue
        rect = Rect.of(element["box"])
        sides = _outside(rect, area, tolerance)
        if not sides:
            continue
        target = _clamp_into(rect, area)
        out.add(
            title="Текст обрезан краем слайда",
            detail=f"Текстовый блок выходит за край слайда ({', '.join(sides)}), часть текста "
            "не будет видна.",
            element=element,
            quote=" ".join(element_texts(element)),
            measured=f"x={rect.x}, y={rect.y}, cx={rect.cx}, cy={rect.cy}",
            expected=f"внутри 0..{area.cx} × 0..{area.cy} EMU",
            ops=_move(element, target) if target else None,
            rationale="Вернуть текстовый блок внутрь слайда",
        )
    return out.findings


def overlap(check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext) -> list[Finding]:
    out = _Emitter(check, slide)
    min_share = ctx.params[check.id]["minOverlapShare"]
    content = [e for e in slide["elements"] if is_content(e)]
    for lower, upper in combinations(content, 2):
        if share_groups(lower, upper):
            continue
        a, b = Rect.of(lower["box"]), Rect.of(upper["box"])
        common = a.intersection(b)
        if common is None:
            continue
        share = common.area / max(min(a.area, b.area), 1)
        if share < min_share:
            continue
        out.add(
            title="Блоки наложились друг на друга",
            detail=f"«{upper['elementId']}» перекрывает «{lower['elementId']}» на {_pct(share)} "
            "площади меньшего блока.",
            element=upper,
            box=common.as_box(),
            measured=_pct(share),
            expected=f"меньше {_pct(min_share)}",
        )
    return out.findings


def text_overflow(
    check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext
) -> list[Finding]:
    out = _Emitter(check, slide)
    p = ctx.params[check.id]
    template = ctx.template
    for element in slide["elements"]:
        if not paragraphs_of(element) or not is_content(element):
            continue
        box_height = int(element["box"]["cy"])
        reported = element.get("overflow")
        needed, lines = text_height(element, template, None, p["charWidthEm"], p["lineHeight"])
        if reported:
            measured = f"не влезает {reported['lines']} строк, {_pt(reported['emu'])} за рамкой"
            confidence = 1.0
        elif lines > 1 and needed > box_height * p["slack"]:
            # One line in a box shorter than a line is a tight box, not text that does not fit.
            measured = f"нужно ~{_pt(needed)} ({lines} строк), рамка {_pt(box_height)}"
            confidence = 0.8
        else:
            continue
        current = max(
            (
                float(run["sizePt"])
                for paragraph in paragraphs_of(element)
                for run in paragraph.get("runs", [])
                if run.get("sizePt")
            ),
            default=template.default_size(element["role"]),
        )
        fitting = [
            size
            for size in sorted(template.sizes, reverse=True)
            if size < current
            and size >= max(current * 0.75, p["minSizePt"])
            and text_height(element, template, size, p["charWidthEm"], p["lineHeight"])[0]
            <= box_height
        ]
        ops = (
            [{"op": "set-font-size", "elementId": element["elementId"], "sizePt": fitting[0]}]
            if fitting
            else None
        )
        out.add(
            title="Текст не поместился в рамку",
            detail="Текст длиннее, чем вмещает блок. "
            + (
                f"Можно уменьшить кегль до {fitting[0]:g} pt из шкалы шаблона."
                if fitting
                else "Текст нужно сократить."
            ),
            element=element,
            quote=" ".join(element_texts(element)),
            measured=measured,
            expected=f"высота текста ≤ {_pt(box_height)}",
            ops=ops,
            rationale=f"Уменьшить кегль до {fitting[0]:g} pt" if fitting else "",
            assisted=True,
            confidence=confidence,
        )
    return out.findings


def grid_alignment(
    check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext
) -> list[Finding]:
    out = _Emitter(check, slide)
    template = ctx.template
    tolerance = ctx.params[check.id]["toleranceShare"] * int(slide["slideCx"])
    lefts, rights = template.column_guides()
    pattern = (ctx.patterns or {}).get(slide["patternId"])
    for slot in pattern["slots"] if pattern else []:
        lefts.append(int(slot["box"]["x"]))
        rights.append(int(slot["box"]["x"]) + int(slot["box"]["cx"]))
    centre = int(slide["slideCx"]) / 2
    for element in slide["elements"]:
        if not is_content(element) or element.get("rotation"):
            continue
        rect = Rect.of(element["box"])
        if (
            any(abs(rect.x - g) <= tolerance for g in lefts)
            or any(abs(rect.right - g) <= tolerance for g in rights)
            or abs(rect.x + rect.cx / 2 - centre) <= tolerance
        ):
            continue
        guide = min(lefts, key=lambda g: abs(rect.x - g))
        moved = Rect(guide, rect.y, rect.cx, rect.cy)
        out.add(
            title="Блок не выровнен по направляющим",
            detail="Край блока не совпадает ни с полем, ни с колонкой, ни со слотом макета. "
            f"Ближайшая направляющая в {_pt(abs(rect.x - guide))} от него.",
            element=element,
            measured=f"левый край {rect.x} EMU",
            expected=f"направляющая ±{tolerance:.0f} EMU",
            ops=_move(element, moved),
            rationale="Выровнять по ближайшей направляющей макета",
        )
    return out.findings


def _full_bleed(element: dict[str, Any], slide: Rect) -> bool:
    rect = Rect.of(element["box"])
    return element["kind"] == "image" and (rect.cx >= slide.cx * 0.9 or rect.cy >= slide.cy * 0.9)


def safe_margins(check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext) -> list[Finding]:
    out = _Emitter(check, slide)
    p = ctx.params[check.id]
    area = _slide_rect(slide)
    safe = ctx.template.safe_area(int(p["minMarginPt"] * EMU_PER_PT))
    tolerance = p["toleranceShare"] * area.cx
    pattern = (ctx.patterns or {}).get(slide["patternId"])
    slots = [Rect.of(slot["box"]) for slot in pattern["slots"]] if pattern else []
    for element in slide["elements"]:
        if not is_content(element) or _full_bleed(element, area):
            continue
        rect = Rect.of(element["box"])
        if _outside(rect, area, tolerance):
            continue
        if any(not _outside(rect, slot, tolerance) for slot in slots):
            # Inside a slot of its own layout: the template put it there, margins or not.
            continue
        sides = _outside(rect, safe, tolerance)
        if not sides:
            continue
        target = _clamp_into(rect, safe)
        out.add(
            title="Контент заходит в поля",
            detail=f"Блок заходит в поле шаблона: {', '.join(sides)}.",
            element=element,
            measured=f"x={rect.x}..{rect.right}, y={rect.y}..{rect.bottom}",
            expected=f"x={safe.x}..{safe.right}, y={safe.y}..{safe.bottom}",
            ops=_move(element, target) if target else None,
            rationale="Сдвинуть блок в рабочую область шаблона",
        )
    return out.findings


def image_aspect(check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext) -> list[Finding]:
    out = _Emitter(check, slide)
    limit = ctx.params[check.id]["maxDistortion"]
    for element in slide["elements"]:
        if element["kind"] != "image":
            continue
        size = ctx.media_sizes.get(element["mediaPart"])
        crop = element.get("crop")
        if not size or not crop:
            # Without a crop the export fits the picture by `fit`, which never stretches it.
            continue
        width = size["width"] * (1 - crop["l"] - crop["r"])
        height = size["height"] * (1 - crop["t"] - crop["b"])
        distorted = distortion(element["box"], width, height)
        if distorted <= limit:
            continue
        rect = Rect.of(element["box"])
        fixed = Rect(rect.x, rect.y, rect.cx, round(rect.cx * height / width))
        out.add(
            title="Картинка растянута",
            detail=f"Пропорции видимой части картинки и рамки расходятся на {_pct(distorted)}: "
            "изображение будет искажено.",
            element=element,
            measured=f"рамка {rect.cx / rect.cy:.2f}, картинка {width / height:.2f}",
            expected=f"расхождение ≤ {_pct(limit)}",
            ops=_move(element, fixed),
            rationale="Подогнать высоту рамки под пропорции картинки",
        )
    return out.findings


# Template ------------------------------------------------------------------------------------


def _runs(element: dict[str, Any]) -> list[dict[str, Any]]:
    return [run for paragraph in paragraphs_of(element) for run in paragraph.get("runs", [])]


def font_usage(check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext) -> list[Finding]:
    out = _Emitter(check, slide)
    template = ctx.template
    limit = ctx.params[check.id]["maxDistinctFonts"]
    used: set[str] = set()
    for element in slide["elements"]:
        if not paragraphs_of(element):
            continue
        foreign: list[str] = []
        for run in _runs(element):
            font = run.get("font") or template.default_font(element["role"])
            used.add(font.casefold())
            if run.get("font") and font.casefold() not in template.fonts:
                foreign.append(font)
        if not foreign:
            continue
        fixed = [
            {
                **paragraph,
                "runs": [
                    {**run, "font": ""}
                    if run.get("font") and run["font"].casefold() not in template.fonts
                    else run
                    for run in paragraph.get("runs", [])
                ],
            }
            for paragraph in paragraphs_of(element)
        ]
        names = ", ".join(sorted(set(foreign)))
        out.add(
            title="Шрифт не из шаблона",
            detail=f"В блоке использован шрифт, которого нет в шаблоне: {names}.",
            element=element,
            measured=names,
            expected="шрифты шаблона: " + ", ".join(sorted(template.fonts)),
            ops=[{"op": "set-text", "elementId": element["elementId"], "paragraphs": fixed}],
            rationale="Вернуть шрифт шаблона",
        )
    if len(used) > limit:
        out.add(
            title="Слишком много гарнитур",
            detail=f"На слайде {len(used)} гарнитуры, допускается не больше {limit}.",
            measured=str(len(used)),
            expected=f"≤ {limit}",
            assisted=True,
        )
    return out.findings


def type_scale(check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext) -> list[Finding]:
    out = _Emitter(check, slide)
    sizes = ctx.template.sizes
    tolerance = ctx.params[check.id]["tolerancePt"]
    for element in slide["elements"]:
        stray = sorted(
            {
                float(run["sizePt"])
                for run in _runs(element)
                if run.get("sizePt")
                and all(abs(float(run["sizePt"]) - s) > tolerance for s in sizes)
            }
        )
        if not stray or not sizes:
            continue
        target = min(sizes, key=lambda s: abs(s - stray[0]))
        out.add(
            title="Кегль не из шкалы шаблона",
            detail=f"Размеры {', '.join(f'{s:g}' for s in stray)} pt не входят в типографическую "
            "шкалу шаблона.",
            element=element,
            measured=", ".join(f"{s:g} pt" for s in stray),
            expected="шкала: " + ", ".join(f"{s:g}" for s in sizes) + " pt",
            ops=[{"op": "set-font-size", "elementId": element["elementId"], "sizePt": target}],
            rationale=f"Поставить ближайший кегль шкалы, {target:g} pt",
        )
    return out.findings


def _literal_colours(element: dict[str, Any]) -> list[str]:
    values: list[str | None] = [run.get("color") for run in _runs(element)]
    values.append(element.get("fill"))
    stroke = element.get("stroke")
    if stroke:
        values.append(stroke.get("color"))
    values.append(element.get("bandFill"))
    borders = element.get("borders")
    if borders:
        values.append(borders.get("color"))
    for row in element.get("cellStyles") or []:
        for cell in row or []:
            if cell:
                values.extend([cell.get("fill"), cell.get("color")])
    return [v.upper() for v in values if v and re.fullmatch(r"[0-9a-fA-F]{6}", v)]


def palette(check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext) -> list[Finding]:
    out = _Emitter(check, slide)
    template = ctx.template
    delta = ctx.params[check.id]["maxChannelDelta"]

    def off(colour: str) -> bool:
        return all(hex_distance(colour, c) > delta for c in template.colours)

    background = slide.get("background")
    if background and re.fullmatch(r"[0-9a-fA-F]{6}", background) and off(background.upper()):
        out.add(
            title="Цвет фона не из палитры",
            detail=f"Фон слайда #{background.upper()} не входит в палитру шаблона.",
            measured=f"#{background.upper()}",
            expected="цвета палитры шаблона",
        )
    by_hex = {hex_: role for role, hex_ in template.palette.items()}
    for element in slide["elements"]:
        stray = sorted({c for c in _literal_colours(element) if off(c)})
        if not stray:
            continue
        closest = nearest(stray[0], by_hex)
        ops = None
        if closest and element["kind"] == "text":
            ops = [
                {"op": "set-color", "elementId": element["elementId"], "colorRole": by_hex[closest]}
            ]
        out.add(
            title="Цвет не из палитры шаблона",
            detail=f"В блоке использованы цвета вне палитры: {', '.join('#' + c for c in stray)}.",
            element=element,
            measured=", ".join("#" + c for c in stray),
            expected="палитра: " + ", ".join("#" + c for c in sorted(template.palette.values())),
            ops=ops,
            rationale=f"Заменить на ближайший цвет палитры ({by_hex[closest]})"
            if ops and closest
            else "",
        )
    return out.findings


def _role_set(roles: list[str]) -> set[str]:
    return {role for role in roles if role not in {"footer", "page-number", "logo", "decoration"}}


def template_layout(
    check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext
) -> list[Finding]:
    out = _Emitter(check, slide)
    if ctx.patterns is None or slide["patternId"] in ctx.patterns:
        return out.findings
    roles = _role_set([e["role"] for e in slide["elements"] if is_content(e)])

    def similarity(pattern: dict[str, Any]) -> float:
        slots = _role_set([s["role"] for s in pattern["slots"]])
        return len(roles & slots) / max(len(roles | slots), 1)

    best = max(ctx.patterns.values(), key=similarity, default=None)
    out.add(
        title="Слайд собран не на макете шаблона",
        detail=f"Паттерна «{slide['patternId']}» нет в каталоге шаблона."
        + (f" Ближайший по составу: «{best['patternId']}»." if best else ""),
        measured=slide["patternId"],
        expected=f"один из {len(ctx.patterns)} паттернов шаблона",
        ops=[{"op": "repattern", "patternId": best["patternId"]}] if best else None,
        rationale="Пересобрать слайд на ближайшем макете шаблона",
    )
    return out.findings


def protected_zones(
    check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext
) -> list[Finding]:
    out = _Emitter(check, slide)
    tolerance = ctx.params[check.id]["toleranceShare"] * int(slide["slideCx"])
    min_confidence = ctx.params[check.id]["minZoneConfidence"]
    zones = [z for z in ctx.template.ds["protectedZones"] if z["role"] != "decoration"]
    for zone in zones:
        zone_rect = Rect.of(zone["box"])
        same = [e for e in slide["elements"] if e["role"] == zone["role"]]
        for element in same:
            rect = Rect.of(element["box"])
            shift = max(
                abs(rect.x - zone_rect.x),
                abs(rect.y - zone_rect.y),
                abs(rect.right - zone_rect.right),
                abs(rect.bottom - zone_rect.bottom),
            )
            if shift <= tolerance:
                continue
            label = {"logo": "Логотип", "footer": "Колонтитул", "page-number": "Номер слайда"}
            out.add(
                title=f"{label.get(zone['role'], 'Элемент шаблона')} сдвинут с места",
                detail=f"Элемент отстоит от своего места в шаблоне на {_pt(shift)}.",
                element=element,
                measured=f"сдвиг {_pt(shift)}",
                expected=f"место из шаблона ±{_pt(tolerance)}",
                ops=_move(element, zone_rect),
                rationale="Вернуть элемент на место из шаблона",
            )
        if not same and zone["meta"]["confidence"] < min_confidence:
            # A zone the template fills on a few layouts only is not reserved on this slide.
            continue
        for element in slide["elements"]:
            if not is_content(element):
                continue
            common = Rect.of(element["box"]).intersection(zone_rect)
            if common is None or common.area < zone_rect.area * 0.2:
                continue
            out.add(
                title="Контент закрывает зону шаблона",
                detail=f"Блок перекрывает место, которое шаблон держит под «{zone['role']}».",
                element=element,
                box=common.as_box(),
                measured=_pct(common.area / max(zone_rect.area, 1)),
                expected="зона свободна",
            )
    return out.findings


def _backdrop(slide: dict[str, Any], index: int, template: Template) -> tuple[str | None, bool]:
    """Colour behind the element at `index` and whether the slide stated it explicitly."""
    element = slide["elements"][index]
    if element["kind"] == "decor" and element.get("fill"):
        return template.resolve(element["fill"]), True
    rect = Rect.of(element["box"])
    cx, cy = rect.x + rect.cx / 2, rect.y + rect.cy / 2
    for below in reversed(slide["elements"][:index]):
        if not Rect.of(below["box"]).contains_point(cx, cy):
            continue
        if below["kind"] == "image":
            return None, False
        if below["kind"] == "decor":
            fill = below.get("fill")
            if fill is None and "fill" in below:
                continue
            if fill is None:
                return None, False
            return template.resolve(fill), True
    background = slide.get("background")
    if background:
        return template.resolve(background), True
    return template.default_background(), False


def contrast(check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext) -> list[Finding]:
    out = _Emitter(check, slide)
    template = ctx.template
    minimum = ctx.params[check.id]["minContrastRatio"]
    for index, element in enumerate(slide["elements"]):
        if not paragraphs_of(element):
            continue
        backdrop, stated_backdrop = _backdrop(slide, index, template)
        if backdrop is None:
            continue
        worst: tuple[float, str] | None = None
        for run in _runs(element):
            if not run.get("text", "").strip():
                continue
            stated = bool(run.get("color"))
            if not stated and not stated_backdrop:
                # The template's own pairing of text and background is trusted.
                continue
            colour = (run.get("color") or "").upper() or template.default_text_colour(
                element["role"]
            )
            if not colour:
                continue
            ratio = contrast_ratio(colour, backdrop)
            if worst is None or ratio < worst[0]:
                worst = (ratio, colour)
        if worst is None or worst[0] >= minimum:
            continue
        candidates = [
            (contrast_ratio(template.palette[role], backdrop), role)
            for role in ("text", "text-on-accent", "text-muted")
            if role in template.palette
        ]
        best = max(candidates, default=None)
        ops = None
        if best and best[0] >= minimum and element["kind"] == "text":
            ops = [{"op": "set-color", "elementId": element["elementId"], "colorRole": best[1]}]
        out.add(
            title="Низкий контраст текста",
            detail=f"Текст #{worst[1]} на фоне #{backdrop} читается плохо: контраст "
            f"{worst[0]:.1f}:1.",
            element=element,
            quote=" ".join(element_texts(element)),
            measured=f"{worst[0]:.2f}:1",
            expected=f"≥ {minimum}:1",
            ops=ops,
            rationale=f"Перекрасить текст в роль {best[1]}" if ops and best else "",
        )
    return out.findings


# Density -------------------------------------------------------------------------------------


def _bullets(slide: dict[str, Any]) -> list[tuple[dict[str, Any], str]]:
    listed = [e for e in slide["elements"] if e["role"] == "bullet-list"]
    if listed:
        return [
            (element, paragraph_text(p))
            for element in listed
            for p in paragraphs_of(element)
            if paragraph_text(p).strip()
        ]
    return [
        (element, paragraph_text(p))
        for element in slide["elements"]
        if element["role"] == "body"
        for p in paragraphs_of(element)
        if int(p.get("level", 0)) > 0 and paragraph_text(p).strip()
    ]


def bullet_count(check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext) -> list[Finding]:
    out = _Emitter(check, slide)
    limit = ctx.params[check.id]["maxBulletsPerSlide"]
    bullets = _bullets(slide)
    if len(bullets) > limit:
        out.add(
            title="Слишком много буллетов",
            detail=f"На слайде {len(bullets)} пунктов при пределе {limit}. Их стоит сгруппировать "
            "или разнести на два слайда.",
            element=bullets[0][0],
            measured=str(len(bullets)),
            expected=f"≤ {limit}",
            assisted=True,
        )
    return out.findings


def bullet_length(
    check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext
) -> list[Finding]:
    out = _Emitter(check, slide)
    limit = ctx.params[check.id]["maxWordsPerBullet"]
    for element, text in _bullets(slide):
        count = words(text)
        if count > limit:
            out.add(
                title="Слишком длинный буллет",
                detail=f"Пункт из {count} слов, предел {limit}. Его стоит сократить.",
                element=element,
                quote=text,
                measured=f"{count} слов",
                expected=f"≤ {limit}",
                assisted=True,
            )
    return out.findings


def table_size(check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext) -> list[Finding]:
    out = _Emitter(check, slide)
    p = ctx.params[check.id]
    for element in slide["elements"]:
        if element["kind"] != "table":
            continue
        rows, columns = len(element["rows"]), len(element["headers"])
        if rows <= p["maxRows"] and columns <= p["maxColumns"]:
            continue
        out.add(
            title="Таблица слишком большая",
            detail=f"Таблица {rows}×{columns} (строк × колонок) при пределе "
            f"{p['maxRows']}×{p['maxColumns']}. Её стоит сократить или разбить.",
            element=element,
            measured=f"{rows}×{columns}",
            expected=f"≤ {p['maxRows']}×{p['maxColumns']}",
            assisted=True,
        )
    return out.findings


def chart_series(check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext) -> list[Finding]:
    out = _Emitter(check, slide)
    limit = ctx.params[check.id]["maxSeries"]
    for element in slide["elements"]:
        if element["kind"] == "chart" and len(element["series"]) > limit:
            out.add(
                title="Слишком много серий на диаграмме",
                detail=f"На диаграмме {len(element['series'])} серий при пределе {limit}.",
                element=element,
                measured=str(len(element["series"])),
                expected=f"≤ {limit}",
                assisted=True,
            )
    return out.findings


def chart_labels(
    check: CheckDefinition, slide: dict[str, Any], _ctx: AuditContext
) -> list[Finding]:
    out = _Emitter(check, slide)
    for element in slide["elements"]:
        if element["kind"] != "chart":
            continue
        problems = []
        if element["chartType"] != "pie" and not element.get("yTitle", "").strip():
            problems.append("нет подписи оси значений (и единиц)")
        blank = sum(1 for c in element["categories"] if not c.strip())
        if blank:
            problems.append(f"без подписи {blank} категорий")
        if len(element["series"]) > 1:
            nameless = sum(1 for series in element["series"] if not series["name"].strip())
            if nameless:
                problems.append(f"в легенде без названия {nameless} серий")
        if not problems:
            continue
        out.add(
            title="У диаграммы нет подписей",
            detail="На диаграмме " + "; ".join(problems) + ".",
            element=element,
            measured="; ".join(problems),
            expected="подписаны ось значений, категории и серии легенды",
            assisted=True,
        )
    return out.findings


def slide_fill(check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext) -> list[Finding]:
    out = _Emitter(check, slide)
    p = ctx.params[check.id]
    area = _slide_rect(slide)
    content = [e for e in slide["elements"] if is_content(e)]
    if not content:
        return out.findings
    rects = [r for r in (Rect.of(e["box"]).intersection(area) for e in content) if r]
    filled = fraction_covered(rects, area)
    headline_only = all(e["role"] in {"title", "subtitle"} for e in content)
    single_picture = len(content) <= 2 and any(_full_bleed(e, area) for e in content)
    if filled < p["minFill"] and not headline_only:
        out.add(
            title="Слайд почти пустой",
            detail=f"Контент занимает {_pct(filled)} слайда, меньше {_pct(p['minFill'])}.",
            measured=_pct(filled),
            expected=f"{_pct(p['minFill'])}–{_pct(p['maxFill'])}",
            assisted=True,
        )
    elif filled > p["maxFill"] and not single_picture:
        out.add(
            title="Слайд перегружен",
            detail=f"Контент занимает {_pct(filled)} слайда, больше {_pct(p['maxFill'])}.",
            measured=_pct(filled),
            expected=f"{_pct(p['minFill'])}–{_pct(p['maxFill'])}",
            assisted=True,
        )
    return out.findings


# Content -------------------------------------------------------------------------------------


def empty_slide(check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext) -> list[Finding]:
    out = _Emitter(check, slide)
    content = [
        e
        for e in slide["elements"]
        if is_content(e)
        and (e["kind"] in {"image", "table", "chart"} or any(t.strip() for t in element_texts(e)))
    ]
    if not content:
        out.add(
            title="Пустой слайд",
            detail="На слайде нет ни текста, ни визуальных элементов.",
            expected="на слайде есть содержание",
            assisted=True,
        )
    elif all(e["role"] == "title" for e in content):
        pattern = (ctx.patterns or {}).get(slide["patternId"])
        # A cover or section layout is meant to be sparse, so a bare headline there is minor.
        headline_layout = bool(
            pattern and {"title", "section", "closing"} & set(pattern["intents"])
        )
        out.add(
            title="Слайд с одним заголовком",
            detail="Кроме заголовка на слайде ничего нет.",
            element=content[0],
            quote=" ".join(element_texts(content[0])),
            expected="на слайде есть содержание, а не только заголовок",
            assisted=True,
            severity="minor" if headline_layout else None,
        )
    return out.findings


def raster_slide(check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext) -> list[Finding]:
    out = _Emitter(check, slide)
    area = _slide_rect(slide)
    coverage = ctx.params[check.id]["minCoverage"]
    content = [e for e in slide["elements"] if is_content(e)]
    pictures = [e for e in content if e["kind"] == "image"]
    others = [e for e in content if e["kind"] != "image"]
    for picture in pictures:
        common = Rect.of(picture["box"]).intersection(area)
        if common is None or common.area < area.area * coverage or others:
            continue
        out.add(
            title="Слайд оказался картинкой",
            detail="Весь слайд занят одним изображением, на нём нет редактируемых объектов.",
            element=picture,
            measured=_pct(common.area / area.area),
            expected="слайд собран из нативных объектов",
        )
    return out.findings


def _word_set(slide: dict[str, Any]) -> set[str]:
    text = " ".join(t for e in slide["elements"] if is_content(e) for t in element_texts(e))
    return {w for w in re.findall(r"\w+", text.casefold()) if len(w) > 2}


def duplicate_slide(
    check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext
) -> list[Finding]:
    out = _Emitter(check, slide)
    p = ctx.params[check.id]
    mine = _word_set(slide)
    if len(mine) < p["minWords"]:
        return out.findings
    for other in ctx.deck:
        if other["variant"] != slide["variant"] or other["index"] >= slide["index"]:
            continue
        theirs = _word_set(other)
        similarity = len(mine & theirs) / max(len(mine | theirs), 1)
        if similarity >= p["minSimilarity"]:
            out.add(
                title="Слайд дублирует другой",
                detail=f"Слайд почти повторяет слайд {other['index'] + 1} («{other['slideId']}»): "
                f"совпадает {_pct(similarity)} слов.",
                measured=_pct(similarity),
                expected=f"меньше {_pct(p['minSimilarity'])}",
                assisted=True,
            )
            break
    return out.findings


def placeholder_text(
    check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext
) -> list[Finding]:
    out = _Emitter(check, slide)
    patterns = [str(p).casefold() for p in ctx.params[check.id]["forbiddenPatterns"]]
    for element in slide["elements"]:
        texts = list(element_texts(element))
        joined = " ".join(texts)
        hits = [p for p in patterns if p and p in joined.casefold()]
        if hits:
            out.add(
                title="Остался текст-заглушка",
                detail=f"В блоке остался служебный текст: «{hits[0]}».",
                element=element,
                quote=joined,
                measured=hits[0],
                expected="без текста-заглушки",
                assisted=True,
            )
        elif element["kind"] == "text" and not joined.strip():
            out.add(
                title="Пустой текстовый блок",
                detail="На слайде остался текстовый блок без текста.",
                element=element,
                expected="у каждого текстового блока есть текст",
                ops=[{"op": "remove", "elementId": element["elementId"]}],
                rationale="Убрать пустой блок",
                severity="major",
            )
    return out.findings


_YEAR = re.compile(r"\b(?:19|20)\d{2}\b")
_NUMBERING = re.compile(r"^\s*\d{1,2}[.)]?\s*$")


def _plain(text: str) -> str:
    return " ".join(re.sub(r"[^\w]+", " ", text.casefold()).split())


def template_leftover(
    check: CheckDefinition, slide: dict[str, Any], ctx: AuditContext
) -> list[Finding]:
    out = _Emitter(check, slide)
    samples = ctx.samples.get(slide["slideId"], {})
    for element in slide["elements"]:
        if element["kind"] != "text":
            continue
        text = " ".join(element_texts(element))
        stale = sorted(
            {int(y) for y in _YEAR.findall(text)} - ctx.known_years - set(range(ctx.year, 2100))
        )
        sample = samples.get(element["elementId"], "")
        if stale and ctx.year:
            out.add(
                title="Устаревший год",
                detail=f"В блоке год {stale[0]}: он прошёл, а в исходных материалах его нет. "
                "Скорее всего, это год из образца шаблона.",
                element=element,
                quote=text,
                measured=str(stale[0]),
                expected=f"год из материалов или {ctx.year}",
                assisted=True,
            )
        elif sample and not _NUMBERING.match(sample) and _plain(text) == _plain(sample):
            out.add(
                title="Остался текст образца",
                detail=f"В блоке осталось «{sample.strip()}» из образца шаблона вместо содержания.",
                element=element,
                quote=text,
                measured=sample.strip(),
                expected="содержание вместо текста образца",
                assisted=True,
                severity="minor",
            )
    return out.findings


def empty_image_slot(
    check: CheckDefinition, slide: dict[str, Any], _ctx: AuditContext
) -> list[Finding]:
    out = _Emitter(check, slide)
    for element in slide["elements"]:
        if element["kind"] == "decor" and element["role"] == "image":
            out.add(
                title="Пустой слот картинки",
                detail="На слайде осталась рамка под картинку без картинки: пустой прямоугольник.",
                element=element,
                expected="картинка в слоте или слот убран",
                ops=[{"op": "remove", "elementId": element["elementId"]}],
                rationale="Убрать пустую рамку",
            )
    return out.findings


RULES: dict[str, Rule] = {
    "slide-bounds": slide_bounds,
    "text-clipped": text_clipped,
    "overlap": overlap,
    "text-overflow": text_overflow,
    "grid-alignment": grid_alignment,
    "safe-margins": safe_margins,
    "image-aspect": image_aspect,
    "font-usage": font_usage,
    "type-scale": type_scale,
    "palette": palette,
    "template-layout": template_layout,
    "protected-zones": protected_zones,
    "contrast": contrast,
    "bullet-count": bullet_count,
    "bullet-length": bullet_length,
    "table-size": table_size,
    "chart-series": chart_series,
    "chart-labels": chart_labels,
    "slide-fill": slide_fill,
    "empty-slide": empty_slide,
    "raster-slide": raster_slide,
    "duplicate-slide": duplicate_slide,
    "placeholder-text": placeholder_text,
    "template-leftover": template_leftover,
    "empty-image-slot": empty_image_slot,
}
