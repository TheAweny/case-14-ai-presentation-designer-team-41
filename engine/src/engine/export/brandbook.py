"""I apply declared semantic brand rules while preserving the native OOXML package."""

import re
import shutil
import zipfile
from pathlib import Path
from typing import Any

import lxml.etree as etree
from PIL import Image

_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
_P = "http://schemas.openxmlformats.org/presentationml/2006/main"
_NS = {"a": _A, "p": _P}
_COLORS = {
    "background": "lt1",
    "surface": "lt1",
    "text": "dk1",
    "text-muted": "dk2",
    "primary": "accent1",
    "accent": "accent1",
    "secondary": "accent2",
    "accent-alt": "accent2",
    "line": "accent3",
    "positive": "accent3",
    "negative": "accent4",
    "text-on-accent": "lt1",
}
_FONT_ROLES = {"title", "heading", "body", "text", "primary", "secondary", "all", "default"}
#: Colour roles that paint the runs of titles rather than a theme slot.
_HEADING_COLORS = {"heading", "title"}


def _node(tag: str, **attributes: str) -> Any:
    return etree.Element(f"{{{_A}}}{tag}", **attributes)


def _solid(parent: Any, color: str) -> None:
    for child in list(parent):
        if etree.QName(child).localname in {"solidFill", "noFill", "gradFill", "pattFill"}:
            parent.remove(child)
    fill = _node("solidFill")
    fill.append(_node("srgbClr", val=color))
    parent.insert(0, fill)


def _plain_text_colour(properties: Any, old_text: str | None) -> bool:
    """Whether a run is in the text colour, so a brand's text colour is its own.

    A run in an accent or another set colour keeps it: the template coloured it on purpose.
    """
    fill = properties.find(f"{{{_A}}}solidFill")
    if fill is None or len(fill) == 0:
        return True
    colour = fill[0]
    kind = etree.QName(colour).localname
    if kind == "schemeClr":
        return colour.get("val") in {"tx1", "dk1", "tx2", "dk2"}
    if kind == "srgbClr":
        return bool(old_text) and colour.get("val", "").upper() == old_text
    return False


def _role(element: Any) -> str:
    for ancestor in (element, *element.iterancestors()):
        local = etree.QName(ancestor).localname
        if local in {"titleStyle", "majorFont"}:
            return "title"
        if local == "sp":
            placeholders = ancestor.xpath(".//p:nvPr/p:ph", namespaces=_NS)
            if placeholders and placeholders[0].get("type") in {"title", "ctrTitle"}:
                return "title"
            break
    return "body"


def _applicable(scope: str, name: str) -> bool:
    if scope in {"global", "all", "slides", "document"}:
        return True
    match = re.fullmatch(r"slide:(\d+)", scope)
    return bool(match and name == f"ppt/slides/slide{match[1]}.xml")


def _rules(binding: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
    rules: list[dict[str, Any]] = []
    warnings: list[str] = []
    tokens = binding["profile"]["tokens"]
    # Declared rules decide; rules inferred from logos and font files stand in only without them.
    authority = (
        "explicit" if any(token["authority"] == "explicit" for token in tokens) else "inferred"
    )
    if authority == "inferred" and any(token["authority"] == "inferred" for token in tokens):
        warnings.append(
            "The brandbook declares no rules; colours and fonts inferred from its logos and "
            "font files are applied."
        )
    declared = {
        (token.get("role") or "").lower()
        for token in tokens
        if token["authority"] == authority and token["kind"] == "color"
    }
    for token in tokens:
        if token["authority"] != authority:
            continue
        role = (token.get("role") or "").lower()
        kind, scope = token["kind"], token["scope"]
        if scope not in {"global", "all", "slides", "document"} and not re.fullmatch(
            r"slide:[1-9]\d*", scope
        ):
            warnings.append(f"Brand token {token.get('name', role)}: unsupported scope {scope}.")
            continue
        rule = {**token, "role": role}
        if kind == "color" and role in _HEADING_COLORS:
            if not re.fullmatch(r"#[0-9a-fA-F]{6}", str(token["value"])):
                warnings.append(f"Brand color {token['value']} is not an opaque RGB value.")
                continue
            rule.update(themeRole=None, value=str(token["value"])[1:].upper())
        elif kind == "color":
            # «primary» and «accent» name one slot only when the other is absent; with both,
            # the accent is the second colour, so neither paints over the other.
            role = (
                "accent2" if role == "accent" and "primary" in declared else _COLORS.get(role, role)
            )
            if role not in {"dk1", "dk2", "lt1", "lt2", "hlink", "folHlink"} and not re.fullmatch(
                r"accent[1-6]", role
            ):
                warnings.append(f"Brand color role {role or '(unset)'} has no declared mapping.")
                continue
            if not re.fullmatch(r"#[0-9a-fA-F]{6}", str(token["value"])):
                warnings.append(f"Brand color {token['value']} is not an opaque RGB value.")
                continue
            rule.update(themeRole=role, value=str(token["value"])[1:].upper())
        elif kind in {"font-family", "font-size"} and role in _FONT_ROLES:
            if kind == "font-size":
                value = token["value"]
                if (
                    not isinstance(value, (float, int))
                    or value <= 0
                    or token["unit"] not in {"pt", "px"}
                ):
                    warnings.append(f"Brand font size {value} requires positive px or pt.")
                    continue
                rule["value"] = str(round(value * (0.75 if token["unit"] == "px" else 1) * 100))
        else:
            warnings.append(
                f"Brand token {token.get('name', role)} is retained without application."
            )
            continue
        rules.append(rule)
    return rules, warnings


def _apply(root: Any, name: str, rules: list[dict[str, Any]], old_colors: dict[str, str]) -> None:
    applicable = [rule for rule in rules if _applicable(rule["scope"], name)]
    # A text colour paints every run; a heading colour must come after it to stay on titles.
    applicable.sort(key=lambda rule: rule["kind"] == "color" and rule["themeRole"] is None)
    if applicable:
        for run in root.xpath(".//a:r | .//a:fld", namespaces=_NS):
            if run.find(f"{{{_A}}}rPr") is None:
                run.insert(0, _node("rPr"))
    for rule in applicable:
        kind, role, value = rule["kind"], rule["role"], rule["value"]
        if kind == "color" and rule["themeRole"] is None:
            for props in root.xpath(".//a:rPr | .//a:defRPr | .//a:endParaRPr", namespaces=_NS):
                if _role(props) == "title":
                    _solid(props, value)
        elif kind == "color":
            theme_role = rule["themeRole"]
            for color in root.xpath(f".//a:clrScheme/a:{theme_role}", namespaces=_NS):
                color[:] = [_node("srgbClr", val=value)]
            for color in root.xpath(".//a:schemeClr", namespaces=_NS):
                if color.get("val") == theme_role:
                    color.tag = f"{{{_A}}}srgbClr"
                    color.set("val", value)
            old = old_colors.get(theme_role)
            if old:
                for color in root.xpath(".//a:srgbClr", namespaces=_NS):
                    if color.get("val", "").upper() == old:
                        color.set("val", value)
            if role == "text":
                for properties in root.xpath(
                    ".//a:rPr | .//a:defRPr | .//a:endParaRPr", namespaces=_NS
                ):
                    if _plain_text_colour(properties, old_colors.get("dk1")):
                        _solid(properties, value)
            if role == "background" and name.startswith("ppt/slides/slide"):
                common = root.find(f"{{{_P}}}cSld")
                if common is not None:
                    background = common.find(f"{{{_P}}}bg")
                    if background is None:
                        background = etree.Element(f"{{{_P}}}bg")
                        common.insert(0, background)
                    background[:] = [etree.Element(f"{{{_P}}}bgPr")]
                    _solid(background[0], value)
        else:
            wanted = "title" if role in {"title", "heading", "secondary"} else "body"
            universal = role in {"all", "default"}
            properties = root.xpath(".//a:rPr | .//a:defRPr | .//a:endParaRPr", namespaces=_NS)
            for props in properties:
                if not universal and _role(props) != wanted:
                    continue
                if kind == "font-size":
                    props.set("sz", value)
                else:
                    for script in ("latin", "ea", "cs"):
                        child = props.find(f"{{{_A}}}{script}")
                        if child is None:
                            child = _node(script)
                            props.append(child)
                        child.set("typeface", str(value))
            if kind == "font-family":
                families = (
                    ("majorFont", "minorFont")
                    if universal
                    else ("majorFont",)
                    if wanted == "title"
                    else ("minorFont",)
                )
                for family in families:
                    for child in root.xpath(f".//a:{family}/a:latin", namespaces=_NS):
                        child.set("typeface", str(value))


def apply_brandbook(source: Path, target: Path, binding: dict[str, Any]) -> list[str]:
    """I preserve bytes for template priority and apply only supported explicit semantic tokens."""
    source, target = Path(source), Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    rules, warnings = ([], []) if binding.get("priority") == "template" else _rules(binding)
    logo = None if binding.get("priority") == "template" else _logo_asset(binding)
    if not rules:
        if source.resolve() != target.resolve():
            shutil.copyfile(source, target)
        if logo is not None:
            warnings.append(
                f"Brand logo {logo.name} placed on {place_logo(target, logo)} slide(s)."
            )
        return warnings
    with zipfile.ZipFile(source) as archive:
        entries = [(info, archive.read(info)) for info in archive.infolist()]
    old_colors: dict[str, str] = {}
    parser = etree.XMLParser(resolve_entities=False, no_network=True)
    for info, payload in entries:
        if info.filename.startswith("ppt/theme/") and info.filename.endswith(".xml"):
            root = etree.fromstring(payload, parser)
            for node in root.xpath(".//a:clrScheme/*", namespaces=_NS):
                if len(node):
                    value = node[0].get("val") or node[0].get("lastClr")
                    if value and re.fullmatch(r"[0-9a-fA-F]{6}", value):
                        old_colors[etree.QName(node).localname] = value.upper()
    with zipfile.ZipFile(target, "w") as output:
        for info, payload in entries:
            if info.filename.startswith("ppt/") and info.filename.endswith(".xml"):
                root = etree.fromstring(payload, parser)
                _apply(root, info.filename, rules, old_colors)
                payload = etree.tostring(
                    root, xml_declaration=True, encoding="UTF-8", standalone=True
                )
            output.writestr(info, payload)
    if logo is not None:
        warnings.append(f"Brand logo {logo.name} placed on {place_logo(target, logo)} slide(s).")
    return warnings


#: The logo's height on a slide and its distance from the slide's edges.
_LOGO_HEIGHT = 0.5 * 914400
_LOGO_MARGIN = 0.35 * 914400
_LOGO_RASTER = {"image/png", "image/jpeg"}


def _logo_asset(binding: dict[str, Any]) -> Path | None:
    """The brand's logo for a light slide: a raster named a logo, drawn in the brand's colour.

    A file named `…white…` is the variant for dark backgrounds and is left out. Of the rest, one
    whose dominant colour is the brand's main one comes first, then the largest.
    """
    root = binding.get("assetRoot")
    if not root:
        return None
    base = Path(root).resolve()
    profile = binding["profile"]
    tokens = profile["tokens"]
    primary = next(
        (
            str(token["value"]).upper()
            for token in tokens
            if token["kind"] == "color"
            and (token.get("role") or "") in ("primary", "accent")
            and token["authority"] in ("explicit", "inferred")
        ),
        None,
    )
    drawn_in = {
        evidence["sourceId"]: str(token["value"]).upper()
        for token in tokens
        if token["kind"] == "color"
        for evidence in token["evidence"]
        if str(evidence.get("locator", "")).startswith("pixels:")
    }

    def near(colour: str | None) -> bool:
        if not colour or not primary:
            return False
        a = [int(colour[i : i + 2], 16) for i in (1, 3, 5)]
        b = [int(primary[i : i + 2], 16) for i in (1, 3, 5)]
        return sum((x - y) ** 2 for x, y in zip(a, b, strict=True)) ** 0.5 <= 70

    candidates = []
    for asset in profile["assets"]:
        name = str(asset.get("name", "")).lower()
        if asset.get("mediaType") not in _LOGO_RASTER or "logo" not in name or "white" in name:
            continue
        path = (base / str(asset["path"])).resolve()
        if base not in path.parents or not path.is_file():
            continue
        area = float(asset.get("width") or 0) * float(asset.get("height") or 0)
        candidates.append((not near(drawn_in.get(asset["sourceId"])), -area, str(path)))
    return Path(sorted(candidates)[0][2]) if candidates else None


def _free(box: tuple[int, int, int, int], taken: list[tuple[int, int, int, int]]) -> bool:
    left, top, width, height = box
    return all(
        left + width <= x or x + w <= left or top + height <= y or y + h <= top
        for x, y, w, h in taken
    )


def place_logo(path: Path, logo: Path) -> int:
    """Put the logo in a free corner of every slide of the template; the number of slides it got.

    Top right is tried first, then top left, bottom right and bottom left. A corner where any
    shape of the slide sits is not free; a slide with no free corner keeps its look.
    """
    import pptx
    from pptx.util import Emu

    presentation = pptx.Presentation(str(path))
    width, height = presentation.slide_width or 0, presentation.slide_height or 0
    with Image.open(logo) as picture:
        ratio = picture.width / max(1, picture.height)
    logo_height = int(_LOGO_HEIGHT)
    logo_width = int(_LOGO_HEIGHT * ratio)
    margin = int(_LOGO_MARGIN)
    corners = [
        (width - margin - logo_width, margin),
        (margin, margin),
        (width - margin - logo_width, height - margin - logo_height),
        (margin, height - margin - logo_height),
    ]
    placed = 0
    for slide in presentation.slides:
        taken = [
            (int(shape.left), int(shape.top), int(shape.width), int(shape.height))
            for shape in slide.shapes
            if shape.width is not None
            and shape.height is not None
            and shape.left is not None
            and shape.top is not None
            and int(shape.width) * int(shape.height) < 0.9 * width * height
        ]
        for left, top in corners:
            if _free((left, top, logo_width, logo_height), taken):
                slide.shapes.add_picture(
                    str(logo), Emu(left), Emu(top), Emu(logo_width), Emu(logo_height)
                )
                placed += 1
                break
    presentation.save(str(path))
    return placed
