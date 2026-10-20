"""Deterministic brand inputs preserve evidence and reject unsafe packages."""

import hashlib
import io
import json
import zipfile
from pathlib import Path

import pytest
from engine.parser.brandbook import BrandbookError, parse_brandbook
from PIL import Image


def parse(tmp_path: Path, name: str, data: bytes) -> dict:
    source = tmp_path / name
    source.write_bytes(data)
    return parse_brandbook(source, tmp_path / "out")


def test_dtcg_aliases_and_role(tmp_path):
    data = {
        "color": {
            "primary": {"$type": "color", "$value": "#123456"},
            "accent": {"$type": "color", "$value": "{color.primary}"},
        }
    }
    result = parse(tmp_path, "tokens.json", json.dumps(data).encode())
    assert [t["value"] for t in result["tokens"]] == ["#123456", "#123456"]
    assert all(t["authority"] == "explicit" for t in result["tokens"])
    assert result["status"] == "ready"


def test_alias_cycles_and_missing_are_partial(tmp_path):
    data = {
        "a": {"type": "color", "value": "{b}"},
        "b": {"type": "color", "value": "{a}"},
        "c": {"type": "color", "value": "{missing}"},
    }
    result = parse(tmp_path, "tokens.json", json.dumps(data).encode())
    assert not result["tokens"]
    assert result["status"] == "partial"
    assert result["sources"][0]["warnings"]


def test_svg_is_observed_and_preserves_size(tmp_path):
    result = parse(
        tmp_path,
        "logo.svg",
        b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40">'
        b'<path fill="#abc" d="M0 0"/></svg>',
    )
    assert result["tokens"][0]["value"] == "#AABBCC"
    assert result["tokens"][0]["authority"] == "observed"
    assert result["assets"][0]["width"] == 100
    assert result["assets"][0]["kind"] == "vector"


def test_nested_archive_inventory_and_digest(tmp_path):
    nested = io.BytesIO()
    with zipfile.ZipFile(nested, "w") as archive:
        archive.writestr("palette.json", '{"primary":{"type":"color","value":"#123456"}}')
    outer = io.BytesIO()
    with zipfile.ZipFile(outer, "w") as archive:
        archive.writestr("nested.zip", nested.getvalue())
        archive.writestr("unknown.xyz", b"abc")
    result = parse(tmp_path, "brand.zip", outer.getvalue())
    assert len(result["sources"]) == 4
    assert result["sources"][0]["sha256"] == hashlib.sha256(outer.getvalue()).hexdigest()
    assert result["coverage"]["filesUnsupported"] == 1
    assert result["status"] == "partial"


@pytest.mark.parametrize(
    "name", ["../escape.svg", "/escape.svg", "C:/escape.svg", "folder\\..\\escape.svg"]
)
def test_archive_traversal_rejected(tmp_path, name):
    content = io.BytesIO()
    with zipfile.ZipFile(content, "w") as archive:
        archive.writestr(name, b"<svg/>")
    with pytest.raises(BrandbookError):
        parse(tmp_path, "unsafe.zip", content.getvalue())
    assert not (tmp_path / "escape.svg").exists()


def test_raster_dimensions_and_safe_asset(tmp_path):
    buffer = io.BytesIO()
    Image.new("RGB", (80, 50), "red").save(buffer, format="PNG")
    result = parse(tmp_path, "image.png", buffer.getvalue())
    asset = result["assets"][0]
    assert (asset["width"], asset["height"]) == (80, 50)
    assert (tmp_path / "out" / asset["path"]).read_bytes() == buffer.getvalue()
    assert not result["tokens"]


def test_figma_json_structure_typography(tmp_path):
    doc = {
        "document": {
            "id": "0:0",
            "name": "Doc",
            "type": "DOCUMENT",
            "children": [
                {
                    "id": "1:1",
                    "name": "Cover",
                    "type": "FRAME",
                    "children": [
                        {
                            "id": "2:1",
                            "name": "Title",
                            "type": "TEXT",
                            "characters": "Hello",
                            "style": {"fontFamily": "Inter", "fontSize": 32},
                            "fills": [{"type": "SOLID", "color": {"r": 1, "g": 0, "b": 0}}],
                        }
                    ],
                }
            ],
        }
    }
    result = parse(tmp_path, "figma.json", json.dumps(doc).encode())
    assert any(s["text"] == "Hello" for s in result["sections"])
    assert any(t["value"] == "Inter" for t in result["tokens"])
    assert all(t["authority"] == "observed" for t in result["tokens"])


def test_malformed_input_never_ready(tmp_path):
    result = parse(tmp_path, "bad.json", b"{broken")
    assert result["status"] == "partial"
    assert result["sources"][0]["status"] == "partial"
