"""A missing template face warns and still leaves that face in the exported file."""

import zipfile
from pathlib import Path
from xml.etree import ElementTree

from engine.api.app import app
from engine.parser.compositions import extract_compositions
from fastapi.testclient import TestClient
from pptx import Presentation
from pptx.util import Inches, Pt

from engine import render

_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"


def _source(path: Path, family: str) -> Path:
    deck = Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[6])
    shape = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(6), Inches(1.2))
    run = shape.text_frame.paragraphs[0].add_run()
    run.text = "Заголовок"
    run.font.size = Pt(28)
    run.font.name = family
    deck.save(str(path))
    return path


def _request(source: Path, output: Path) -> dict:
    pattern = extract_compositions(source)[0]
    return {
        "schemaVersion": 1,
        "templatePath": str(source),
        "outputPath": str(output),
        "slides": [
            {
                "patternId": pattern["patternId"],
                "texts": [{"slotId": pattern["slots"][0]["slotId"], "text": "Новый заголовок"}],
                "speakerNotes": "",
            }
        ],
    }


def _stub_preview(monkeypatch) -> None:
    def render_to_png(pptx_path, output_dir, dpi=110, **kwargs):
        output_dir.mkdir(parents=True, exist_ok=True)
        image = output_dir / "slide-1.png"
        image.write_bytes(b"png")
        return [image]

    monkeypatch.setattr(render, "render_to_png", render_to_png)


def _stub_fonts(monkeypatch, present: set[str]) -> list[set[str]]:
    seen: list[set[str]] = []

    def missing(families: set[str]) -> list[str]:
        seen.append(set(families))
        return sorted(family for family in families if family and family not in present)

    monkeypatch.setattr(render, "missing_fonts", missing)
    return seen


def _typefaces(path: Path, text: str) -> set[str]:
    found: set[str] = set()
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if not name.startswith("ppt/slides/slide") or not name.endswith(".xml"):
                continue
            root = ElementTree.fromstring(archive.read(name))
            for paragraph in root.iter(f"{_A}p"):
                written = "".join(node.text or "" for node in paragraph.iter(f"{_A}t"))
                if text not in written:
                    continue
                for node in paragraph.iter(f"{_A}latin"):
                    face = node.get("typeface")
                    if face:
                        found.add(face)
    return found


def test_absent_font_exports_and_keeps_the_template_typeface(tmp_path: Path, monkeypatch) -> None:
    family = "Template Face"
    source = _source(tmp_path / "in.pptx", family)
    assert extract_compositions(source)[0]["slots"][0]["font"] == family
    output = tmp_path / "out.pptx"
    _stub_preview(monkeypatch)
    seen = _stub_fonts(monkeypatch, set())
    response = TestClient(app).post("/v1/composition-decks", json=_request(source, output))
    assert response.status_code == 200, response.text
    body = response.json()
    assert seen == [{family}]
    assert body["missingFonts"] == [family]
    assert (
        "Fonts not installed on the render server: Template Face. "
        "The .pptx keeps the template fonts; previews use substitutes."
    ) in body["warnings"]
    assert _typefaces(output, "Новый заголовок") == {family}


_ABSENT_WHEN_UNSET = ("bullet", "marginEmu", "indentEmu", "spaceBeforePt", "spaceAfterPt", "align")


def _paragraphs(node: object) -> list[dict]:
    found: list[dict] = []
    if isinstance(node, dict):
        if "runs" in node and "level" in node:
            found.append(node)
        for value in node.values():
            found.extend(_paragraphs(value))
    elif isinstance(node, list):
        for item in node:
            found.extend(_paragraphs(item))
    return found


def test_export_omits_unset_paragraph_fields(tmp_path: Path, monkeypatch) -> None:
    source = _source(tmp_path / "in.pptx", "Template Face")
    output = tmp_path / "out.pptx"
    _stub_preview(monkeypatch)
    _stub_fonts(monkeypatch, {"Template Face"})
    response = TestClient(app).post("/v1/composition-decks", json=_request(source, output))
    assert response.status_code == 200, response.text
    paragraphs = _paragraphs(response.json()["templateIr"])
    assert paragraphs
    for paragraph in paragraphs:
        assert "lineSpacing" in paragraph
        for key in _ABSENT_WHEN_UNSET:
            assert key not in paragraph or paragraph[key] is not None


def test_installed_font_exports_without_a_font_warning(tmp_path: Path, monkeypatch) -> None:
    family = "Template Face"
    source = _source(tmp_path / "in.pptx", family)
    output = tmp_path / "out.pptx"
    _stub_preview(monkeypatch)
    _stub_fonts(monkeypatch, {family})
    response = TestClient(app).post("/v1/composition-decks", json=_request(source, output))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["missingFonts"] == []
    assert all("Fonts not installed" not in warning for warning in body["warnings"])
    assert _typefaces(output, "Новый заголовок") == {family}
