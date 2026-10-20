"""I apply declared semantic brand rules while preserving the native OOXML package."""

import re
import shutil
import zipfile
from pathlib import Path
from typing import Any

import lxml.etree as etree

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


def _node(tag: str, **attributes: str) -> Any:
    return etree.Element(f"{{{_A}}}{tag}", **attributes)


def _solid(parent: Any, color: str) -> None:
    for child in list(parent):
        if etree.QName(child).localname in {"solidFill", "noFill", "gradFill", "pattFill"}:
            parent.remove(child)
    fill = _node("solidFill")
    fill.append(_node("srgbClr", val=color))
    parent.insert(0, fill)


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
    for token in binding["profile"]["tokens"]:
        if token["authority"] != "explicit":
            continue
        role = (token.get("role") or "").lower()
        kind, scope = token["kind"], token["scope"]
        if scope not in {"global", "all", "slides", "document"} and not re.fullmatch(
            r"slide:[1-9]\d*", scope
        ):
            warnings.append(f"Brand token {token.get('name', role)}: unsupported scope {scope}.")
            continue
        rule = {**token, "role": role}
        if kind == "color":
            role = _COLORS.get(role, role)
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
    if applicable:
        for run in root.xpath(".//a:r | .//a:fld", namespaces=_NS):
            if run.find(f"{{{_A}}}rPr") is None:
                run.insert(0, _node("rPr"))
    for rule in applicable:
        kind, role, value = rule["kind"], rule["role"], rule["value"]
        if kind == "color":
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
                family = "majorFont" if wanted == "title" else "minorFont"
                for child in root.xpath(f".//a:{family}/a:latin", namespaces=_NS):
                    child.set("typeface", str(value))


def apply_brandbook(source: Path, target: Path, binding: dict[str, Any]) -> list[str]:
    """I preserve bytes for template priority and apply only supported explicit semantic tokens."""
    source, target = Path(source), Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    rules, warnings = ([], []) if binding.get("priority") == "template" else _rules(binding)
    if not rules:
        if source.resolve() != target.resolve():
            shutil.copyfile(source, target)
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
    return warnings
