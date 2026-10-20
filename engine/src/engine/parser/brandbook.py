"""Evidence-preserving deterministic brandbook ingestion, without model calls."""

from __future__ import annotations

import hashlib
import io
import json
import math
import re
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, cast

from PIL import Image

from .brandbook_archives import (
    MAX_DEPTH,
    MAX_ENTRIES,
    MAX_FILE,
    MAX_TOTAL,
    ArchiveError,
    rar_members,
    zip_members,
)

PARSER_VERSION = "1.0.0"
MAX_NODES = 30000
MAX_SECONDS = 90


class BrandbookError(ValueError):
    """A bounded, actionable parser failure suitable for an API response."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _number(value: Any) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = float(value)
        if math.isfinite(number) and number >= 0:
            return number
    return None


def _hex(value: str) -> str | None:
    if re.fullmatch(r"#[0-9a-fA-F]{3,4}", value):
        return "#" + "".join(char * 2 for char in value[1:]).upper()
    if re.fullmatch(r"#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?", value):
        return value.upper()
    return None


class _Parser:
    def __init__(self, output: Path):
        self.output = output
        self.sources: list[dict] = []
        self.tokens: list[dict] = []
        self.assets: list[dict] = []
        self.sections: list[dict] = []
        self.needs_ocr = False
        self.total = 0
        self.started = time.monotonic()
        self.nodes = 0

    def budget(self):
        self.nodes += 1
        if self.nodes > MAX_NODES or time.monotonic() - self.started > MAX_SECONDS:
            raise BrandbookError(413, "Brandbook structural/time limit exceeded")

    def warn(self, source: dict, message: str):
        if message not in source["warnings"]:
            source["warnings"].append(message)
        source["status"] = "partial"

    def token(
        self,
        source,
        name,
        kind,
        value,
        locator,
        *,
        unit=None,
        role=None,
        authority="observed",
        scope="document",
    ):
        if not isinstance(value, (str, int, float)) or isinstance(value, bool):
            return
        if isinstance(value, float) and not math.isfinite(value):
            return
        if isinstance(value, str) and (not value or len(value) > 12000):
            return
        self.tokens.append(
            {
                "id": f"token-{len(self.tokens)}",
                "name": str(name)[:1000] or kind,
                "kind": kind,
                "value": value,
                "unit": unit,
                "role": role,
                "scope": str(scope)[:1000] or "document",
                "authority": authority,
                "confidence": 1,
                "evidence": [
                    {"sourceId": source["id"], "locator": locator, "excerpt": str(value)[:4000]}
                ],
            }
        )

    def section(self, source, kind, name, locator, text="", width=None, height=None, parent=None):
        section_id = f"section-{len(self.sections)}"
        self.sections.append(
            {
                "id": section_id,
                "sourceId": source["id"],
                "kind": kind,
                "name": str(name),
                "locator": locator,
                "text": str(text)[:50000],
                "width": _number(width),
                "height": _number(height),
                "parentId": parent,
            }
        )
        if len(str(text)) > 50000:
            self.warn(source, f"Text truncated at {locator}")
        return section_id

    def asset(self, source, data, name, kind, media, *, width=None, height=None, family=None):
        digest = _digest(data)
        suffix = Path(name).suffix.lower()
        if not re.fullmatch(r"\.[a-z0-9]{1,8}", suffix):
            suffix = ".bin"
        relative = f"assets/{digest}{suffix}"
        target = self.output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_symlink():
            raise BrandbookError(422, "Asset destination cannot be a link")
        target.write_bytes(data)
        self.assets.append(
            {
                "id": f"asset-{len(self.assets)}",
                "sourceId": source["id"],
                "path": relative,
                "name": Path(name).name,
                "kind": kind,
                "mediaType": media,
                "sha256": digest,
                "sizeBytes": len(data),
                "width": _number(width),
                "height": _number(height),
                "fontFamily": family,
            }
        )

    def ingest(self, name: str, data: bytes, depth=0):
        self.budget()
        self.total += len(data)
        if len(data) > MAX_FILE or self.total > MAX_TOTAL or len(self.sources) >= MAX_ENTRIES:
            raise BrandbookError(413, "Brandbook file/expanded-byte limit exceeded")
        if depth > MAX_DEPTH:
            raise BrandbookError(413, "Nested archive depth exceeded")
        extension = Path(name).suffix.lower().lstrip(".") or "unknown"
        source = {
            "id": f"source-{len(self.sources)}",
            "path": name,
            "format": extension,
            "sha256": _digest(data),
            "sizeBytes": len(data),
            "status": "parsed",
            "warnings": [],
        }
        self.sources.append(source)
        try:
            if extension in ("zip", "rar"):
                entries = zip_members(data) if extension == "zip" else rar_members(data)
                count = 0
                for member, payload in entries:
                    count += 1
                    self.ingest(f"{name}!/{member}", payload, depth + 1)
                if not count:
                    self.warn(source, "Archive contains no regular files")
            elif extension == "json":
                self.json(source, json.loads(data))
            elif extension == "fig":
                from .brandbook_fig import decode_fig

                decoded = decode_fig(data)
                self.figma(source, decoded)
            elif extension == "svg":
                self.svg(source, data)
            elif extension in ("png", "jpg", "jpeg", "webp", "gif", "tif", "tiff", "bmp", "ico"):
                self.raster(source, data)
            elif extension in ("ttf", "otf", "woff", "woff2", "ttc"):
                self.font(source, data)
            elif extension == "pdf":
                self.pdf(source, data)
            elif extension in ("pptx", "potx"):
                self.pptx(source, data)
            elif extension in ("txt", "md"):
                text = data.decode("utf-8-sig")
                self.section(source, "rule", Path(name).name, "text", text)
                self.declarations(source, text, "text")
            else:
                source["status"] = "unsupported"
                source["warnings"].append(f"Unsupported format: {extension}")
        except BrandbookError:
            raise
        except (ArchiveError, OSError) as exc:
            if extension in ("zip", "rar"):
                raise BrandbookError(422, str(exc)) from exc
            self.warn(source, f"Cannot fully parse {extension}: {str(exc)[:500]}")
        except Exception as exc:
            self.warn(source, f"Cannot fully parse {extension}: {str(exc)[:500]}")

    def json(self, source, document):
        if not isinstance(document, dict):
            self.warn(source, "JSON root must be an object")
            return
        if "document" in document or "nodeChanges" in document:
            self.figma(source, document)
            return
        entries = {}

        def collect(node, path="", inherited=None):
            self.budget()
            if not isinstance(node, dict):
                return
            token_type = node.get("$type", node.get("type", inherited))
            if "$value" in node or "value" in node:
                entries[path] = (node.get("$value", node.get("value")), token_type, node)
            else:
                for key, child in node.items():
                    if not key.startswith("$"):
                        collect(child, f"{path}.{key}".strip("."), token_type)

        collect(document)

        def resolve(name, trail=()):
            if name in trail or len(trail) > 64:
                raise ValueError(f"Token alias cycle: {name}")
            if name not in entries:
                raise ValueError(f"Missing token alias: {name}")
            value = entries[name][0]
            if isinstance(value, str) and re.fullmatch(r"\{[^{}]+\}", value):
                return resolve(value[1:-1], (*trail, name))
            return value

        kind_map = {
            "color": "color",
            "fontFamily": "font-family",
            "font-family": "font-family",
            "fontSize": "font-size",
            "font-size": "font-size",
            "spacing": "spacing",
            "dimension": "spacing",
            "borderRadius": "radius",
            "radius": "radius",
            "grid": "grid",
            "rule": "rule",
        }
        for name, (_, token_type, node) in entries.items():
            try:
                value = resolve(name)
            except ValueError as exc:
                self.warn(source, str(exc))
                continue
            kind = kind_map.get(token_type)
            if not kind and isinstance(value, str) and _hex(value):
                kind = "color"
            if not kind:
                self.warn(source, f"Unsupported token type at {name}: {token_type}")
                continue
            unit = None
            if kind == "color":
                value = self.color(value)
                if value is None:
                    self.warn(source, f"Unsupported color value at {name}")
                    continue
            elif isinstance(value, dict) and "value" in value and "unit" in value:
                unit = {"%": "percent"}.get(value["unit"], value["unit"])
                if unit not in ("px", "pt", "emu", "percent"):
                    self.warn(source, f"Unsupported dimension unit at {name}")
                    continue
                value = value["value"]
            elif isinstance(value, str) and kind in ("spacing", "radius", "font-size"):
                match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)(px|pt|emu|%)", value)
                if match:
                    value, unit = float(match[1]), {"%": "percent"}.get(match[2], match[2])
            if kind == "font-family" and isinstance(value, list):
                value = ", ".join(str(item) for item in value)
            if isinstance(value, (dict, list)):
                self.warn(source, f"Unsupported structured token at {name}")
                continue
            role = node.get("role", node.get("$extensions", {}).get("role"))
            self.token(
                source,
                name,
                kind,
                value,
                f"$.{name}",
                unit=unit,
                role=role if isinstance(role, str) else None,
                authority="explicit",
            )
        if not entries:
            self.warn(source, "No design tokens or Figma document found")

    @staticmethod
    def color(value):
        if isinstance(value, str):
            return _hex(value)
        if isinstance(value, dict):
            if value.get("colorSpace") == "srgb" and isinstance(value.get("components"), list):
                components = value["components"]
                if len(components) == 3 and all(
                    isinstance(v, (float, int)) and 0 <= v <= 1 for v in components
                ):
                    rgb = "#" + "".join(f"{round(v * 255):02X}" for v in components)
                    alpha = value.get("alpha", 1)
                    return rgb if alpha == 1 else rgb + f"{round(alpha * 255):02X}"
            if all(key in value for key in ("r", "g", "b")):
                vals = [value[key] for key in ("r", "g", "b")]
                if all(isinstance(v, (float, int)) and 0 <= v <= 1 for v in vals):
                    return "#" + "".join(f"{round(v * 255):02X}" for v in vals)
        return None

    def figma(self, source, document):
        changes = document.get("nodeChanges")
        root = document.get("document", document)
        if isinstance(changes, list):
            roots = changes
        elif isinstance(root, dict) and ("type" in root or "children" in root):
            roots = [root]
        else:
            self.warn(source, "Figma document has no decodable nodes")
            return
        parents = {}
        if changes:
            for node in roots:
                guid = node.get("guid", node.get("id"))
                parent_index = node.get("parentIndex", {})
                if isinstance(parent_index, dict):
                    parents[str(guid)] = str(parent_index.get("guid", ""))
        emitted = {}
        pending = []

        def walk(node, parent=None):
            self.budget()
            if not isinstance(node, dict):
                return
            node_id = str(node.get("id", node.get("guid", len(self.sections))))
            locator = f"node:{node_id}"
            node_type = node.get("type", "GROUP")
            kind = {"CANVAS": "page", "FRAME": "frame", "COMPONENT": "frame", "TEXT": "text"}.get(
                node_type, "group"
            )
            bounds = node.get("absoluteBoundingBox", node.get("size", {})) or {}
            text = node.get("characters", node.get("textData", {}).get("characters", ""))
            section = self.section(
                source,
                kind,
                node.get("name", node_id),
                locator,
                text,
                bounds.get("width", bounds.get("x")),
                bounds.get("height", bounds.get("y")),
                parent,
            )
            emitted[node_id] = section
            if changes:
                pending.append((section, parents.get(node_id)))
            style = node.get("style") or node
            family = style.get("fontFamily", style.get("fontName", {}))
            if isinstance(family, dict):
                family = family.get("family")
            if isinstance(family, str):
                self.token(source, "fontFamily", "font-family", family, locator, scope=locator)
            size = style.get("fontSize")
            if _number(size) is not None:
                self.token(source, "fontSize", "font-size", size, locator, unit="px", scope=locator)
            for paint in node.get("fills", node.get("fillPaints", [])) or []:
                if paint.get("visible", True) and paint.get("type", "SOLID") == "SOLID":
                    color = self.color(paint.get("color"))
                    if color:
                        self.token(source, "fill", "color", color, locator, scope=locator)
            for key in (
                "itemSpacing",
                "paddingLeft",
                "paddingRight",
                "paddingTop",
                "paddingBottom",
            ):
                if _number(node.get(key)) is not None:
                    self.token(source, key, "spacing", node[key], locator, unit="px", scope=locator)
            for child in node.get("children", []):
                walk(child, section)

        for root_node in roots:
            walk(root_node)
        if pending:
            section_map = {s["id"]: s for s in self.sections}
            for section, parent_guid in pending:
                section_map[section]["parentId"] = emitted.get(parent_guid)
        for warning in document.get("warnings", []):
            self.warn(source, str(warning))
        if document.get("partial"):
            self.warn(source, "Native Figma contains fields outside supported extraction coverage")

    def svg(self, source, data):
        if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
            raise ValueError("SVG DTD/entities are forbidden")
        root = ET.fromstring(data)
        if root.tag.rsplit("}", 1)[-1] != "svg":
            raise ValueError("Document is not SVG")
        view = re.split(r"[\s,]+", root.get("viewBox", "").strip())
        width = height = None
        if len(view) == 4:
            width, height = float(view[2]), float(view[3])
        self.asset(
            source, data, source["path"], "vector", "image/svg+xml", width=width, height=height
        )
        unsafe = False
        for index, element in enumerate(root.iter()):
            self.budget()
            tag = element.tag.rsplit("}", 1)[-1]
            if tag in ("script", "foreignObject") or any(
                k.startswith("on") for k in element.attrib
            ):
                unsafe = True
            locator = f"element:{index}"
            props = dict(element.attrib)
            for declaration in props.get("style", "").split(";"):
                if ":" in declaration:
                    key, value = declaration.split(":", 1)
                    props[key.strip()] = value.strip()
            for key in ("fill", "stroke", "stop-color"):
                color = _hex(props.get(key, ""))
                if color:
                    self.token(source, key, "color", color, locator)
            if props.get("font-family"):
                self.token(source, "font-family", "font-family", props["font-family"], locator)
            if tag == "text":
                self.section(source, "text", "SVG text", locator, "".join(element.itertext()))
            if any(
                "href" in key and not value.startswith("#") for key, value in element.attrib.items()
            ):
                unsafe = True
        if unsafe:
            self.warn(
                source,
                "SVG has active/external content; original retained as download only, "
                "never executed",
            )

    def raster(self, source, data):
        with Image.open(io.BytesIO(data)) as image:
            image.verify()
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
            if width * height > 50_000_000:
                raise ValueError("Raster pixel limit exceeded")
            media = Image.MIME.get(image.format or "", "application/octet-stream")
            self.asset(source, data, source["path"], "image", media, width=width, height=height)

    def font(self, source, data):
        from fontTools.ttLib import TTCollection, TTFont

        fonts = (
            TTCollection(io.BytesIO(data)).fonts
            if data[:4] == b"ttcf"
            else [TTFont(io.BytesIO(data))]
        )
        for font in fonts:
            try:
                family = font["name"].getDebugName(16) or font["name"].getDebugName(1)
                self.asset(
                    source,
                    data,
                    source["path"],
                    "font",
                    "font/otf" if data[:4] == b"OTTO" else "font/ttf",
                    family=family,
                )
                if family:
                    self.token(source, "font-family", "font-family", family, "font:name:family")
            finally:
                font.close()

    def declarations(self, source, text, locator):
        for index, line in enumerate(text.splitlines()):
            location = f"{locator}/line:{index + 1}"
            # I promote only labelled declarations; swatches remain observations.
            for match in re.finditer(
                r"(?i)(?:HEX|color|colour|цвет)\s*[:=]?\s*(#[0-9a-f]{6}(?:[0-9a-f]{2})?)(?![0-9a-f])",
                line,
            ):
                self.token(
                    source, line[:150], "color", match[1].upper(), location, authority="explicit"
                )
            for match in re.finditer(
                r"(?i)\bRGB\s*[:=(]?\s*(\d{1,3})\s*[,; /]\s*(\d{1,3})\s*[,; /]\s*(\d{1,3})", line
            ):
                components = [int(part) for part in match.groups()]
                if max(components) <= 255:
                    self.token(
                        source,
                        line[:150],
                        "color",
                        "#" + "".join(f"{part:02X}" for part in components),
                        location,
                        authority="explicit",
                    )
            font_match = re.search(
                r"(?i)(?:font family|font-family|шрифт|гарнитура)\s*[:=]\s*([^;\n]+)", line
            )
            if font_match:
                self.token(
                    source,
                    "font-family",
                    "font-family",
                    font_match[1].strip(),
                    location,
                    authority="explicit",
                )

    def pdf(self, source, data):
        import pdfplumber

        with pdfplumber.open(io.BytesIO(data)) as pdf:
            if len(pdf.pages) > 500:
                raise ValueError("PDF page limit exceeded")
            for index, page in enumerate(pdf.pages):
                self.budget()
                locator = f"page:{index + 1}"
                text = page.extract_text() or ""
                self.section(
                    source, "page", f"Page {index + 1}", locator, text, page.width, page.height
                )
                self.declarations(source, text, locator)
                if not text.strip() and page.images:
                    self.needs_ocr = True
                    self.warn(
                        source, f"{locator}: image-only page needs OCR; no textual rules inferred"
                    )
                families = sorted(
                    {str(char["fontname"]) for char in page.chars if char.get("fontname")}
                )
                for family in families:
                    self.token(source, "rendered font", "font-family", family, locator)
                colors = set()
                for element in [*page.rects, *page.curves, *page.lines, *page.chars]:
                    self.budget()
                    for key in ("non_stroking_color", "stroking_color"):
                        value = element.get(key)
                        if isinstance(value, (list, tuple)) and len(value) == 3:
                            color = self.color(dict(zip(("r", "g", "b"), value, strict=True)))
                            if color:
                                colors.add(color)
                for color in sorted(colors):
                    self.token(source, "rendered paint", "color", color, locator)
        self.asset(source, data, source["path"], "example", "application/pdf")

    def pptx(self, source, data):
        from pptx import Presentation

        # I reuse the parser's existing document reader for the semantic slide hierarchy.
        from . import parse_template_ir

        for _name, _payload in zip_members(data):
            self.budget()
        temporary = self.output / f".{source['sha256']}.pptx"
        temporary.parent.mkdir(parents=True, exist_ok=True)
        try:
            temporary.write_bytes(data)
            parsed = parse_template_ir(temporary)
            del parsed
            deck = Presentation(io.BytesIO(data))
            for index, slide in enumerate(deck.slides):
                locator = f"slide:{index + 1}"
                text = "\n".join(
                    cast(Any, shape).text for shape in slide.shapes if shape.has_text_frame
                )
                self.section(
                    source,
                    "page",
                    f"Slide {index + 1}",
                    locator,
                    text,
                    int(deck.slide_width or 0),
                    int(deck.slide_height or 0),
                )
                for shape in slide.shapes:
                    self.budget()
                    if not shape.has_text_frame:
                        continue
                    for paragraph in cast(Any, shape).text_frame.paragraphs:
                        for run in paragraph.runs:
                            if run.font.name:
                                self.token(
                                    source, "example font", "font-family", run.font.name, locator
                                )
                            if run.font.size:
                                self.token(
                                    source,
                                    "example font size",
                                    "font-size",
                                    run.font.size.pt,
                                    locator,
                                    unit="pt",
                                )
            self.asset(
                source,
                data,
                source["path"],
                "example",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            )
        finally:
            temporary.unlink(missing_ok=True)


def parse_brandbook(path: Path, output_dir: Path) -> dict:
    """Parse one uploaded file and nested sources into the authoritative BrandbookProfile."""
    path, output_dir = Path(path), Path(output_dir)
    if not path.is_file() or path.is_symlink():
        raise BrandbookError(422, "Brandbook input must be a regular file")
    if path.stat().st_size > MAX_FILE:
        raise BrandbookError(413, "Brandbook upload exceeds 64 MiB")
    if output_dir.is_symlink() or (output_dir / "assets").is_symlink():
        raise BrandbookError(422, "Brandbook output cannot contain symlink directories")
    parser = _Parser(output_dir)
    data = path.read_bytes()
    parser.ingest(path.name, data)
    meaningful = bool(parser.tokens or parser.sections or parser.assets)
    warnings = [
        f"{source['path']}: {warning}"
        for source in parser.sources
        for warning in source["warnings"]
    ]
    return {
        "schemaVersion": 1,
        "parserVersion": PARSER_VERSION,
        "sourceSha256": _digest(data),
        "status": "ready"
        if meaningful and all(s["status"] == "parsed" for s in parser.sources)
        else "partial",
        "sources": parser.sources,
        "tokens": parser.tokens,
        "assets": parser.assets,
        "sections": parser.sections,
        "warnings": warnings,
        "coverage": {
            "filesTotal": len(parser.sources),
            "filesParsed": sum(s["status"] == "parsed" for s in parser.sources),
            "filesUnsupported": sum(s["status"] == "unsupported" for s in parser.sources),
            "needsOcr": parser.needs_ocr,
        },
    }
