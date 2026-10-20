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


@pytest.mark.parametrize("encoding", ["utf-8", "utf-16", "utf-32"])
def test_svg_entities_are_refused_in_every_xml_encoding(tmp_path, encoding):
    xml = '<!DOCTYPE svg [<!ENTITY a "secret">]><svg xmlns="http://www.w3.org/2000/svg"><text>&a;</text></svg>'
    result = parse(tmp_path, "entities.svg", xml.encode(encoding))
    assert result["status"] == "partial"
    assert result["assets"] == []
    assert any("DTD/entities are forbidden" in warning for warning in result["warnings"])


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
    # A picture yields only an observation of the colour it is drawn in, never a rule.
    assert [(t["authority"], t["value"]) for t in result["tokens"]] == [("observed", "#FF0000")]
    assert result["tokens"][0]["evidence"][0]["locator"] == "pixels:share=1.000"


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


# Rules a brandbook implies when it declares none -------------------------------------------


def _logo(*fills: str) -> bytes:
    shapes = "".join(f'<rect width="10" height="10" fill="{fill}"/>' for fill in fills)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">{shapes}</svg>'.encode()


def _picture(colour: str) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (40, 30), colour).save(buffer, format="PNG")
    return buffer.getvalue()


def _package(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return buffer.getvalue()


def _inferred(result: dict) -> dict[str, str]:
    return {t["role"]: t["value"] for t in result["tokens"] if t["authority"] == "inferred"}


def test_a_brandbook_of_logos_implies_its_palette(tmp_path):
    logos = {f"logo_{n}.svg": _logo("#402FFF", "#EC1D35", "#1B1C21", "#EDEDED") for n in (1, 2)}
    result = parse(tmp_path, "brand.zip", _package({**logos, "cover.png": _picture("#4535F5")}))
    assert _inferred(result) == {
        "primary": "#402FFF",
        "secondary": "#EC1D35",
        "heading": "#402FFF",
        "text": "#1B1C21",
    }
    primary = next(t for t in result["tokens"] if t.get("role") == "primary")
    assert primary["confidence"] < 1 and len(primary["evidence"]) == 3


def test_the_pictures_decide_between_two_equally_used_colours(tmp_path):
    logos = {f"logo_{n}.svg": _logo("#402FFF", "#EC1D35") for n in (1, 2)}
    result = parse(tmp_path, "brand.zip", _package({**logos, "cover.png": _picture("#E81F30")}))
    assert _inferred(result)["primary"] == "#EC1D35"


def test_a_colour_in_one_file_only_is_no_brand_colour(tmp_path):
    result = parse(tmp_path, "brand.zip", _package({"logo.svg": _logo("#402FFF", "#1B1C21")}))
    assert _inferred(result) == {}


def test_declared_tokens_leave_nothing_to_infer(tmp_path):
    tokens = {"color": {"brand": {"$type": "color", "$value": "#112233"}}}
    logos = {f"logo_{n}.svg": _logo("#402FFF", "#EC1D35") for n in (1, 2)}
    files = {**logos, "tokens.json": json.dumps(tokens).encode()}
    result = parse(tmp_path, "brand.zip", _package(files))
    assert _inferred(result) == {}


def test_the_font_the_brandbook_ships_is_inferred_plain_before_variants():
    from engine.parser.brandbook_inference import infer_rules

    def font(family: str, n: int) -> dict:
        return {"kind": "font", "fontFamily": family, "sourceId": f"source-{n}"}

    assets = [font("JetBrains Mono", 1), font("JetBrains Mono NL", 2), font("JetBrains Mono", 3)]
    rules = infer_rules([], assets, [])
    assert [(r["kind"], r["role"], r["value"]) for r in rules] == [
        ("font-family", "all", "JetBrains Mono")
    ]
    tied = infer_rules([], [font("Brand Mono NL", 1), font("Brand Mono", 2)], [])
    assert tied[0]["value"] == "Brand Mono"
