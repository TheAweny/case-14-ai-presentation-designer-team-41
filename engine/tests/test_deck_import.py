"""Reading a finished deck back as SlideIR: every slide as it is drawn.

Decks are built here with python-pptx and small XML edits, so each test states the one rule it
exercises and nothing depends on a deck anyone else owns. Expected colours are computed in the
test from the published formulas rather than read back from the code under test.
"""

from __future__ import annotations

import colorsys
import copy
import logging
from collections.abc import Callable
from io import BytesIO
from pathlib import Path
from typing import Any

import lxml.etree as etree
import pytest
from engine.api import app
from engine.contracts import DeckImportResponse, SlideIR
from engine.parser import design_system_of, import_deck
from engine.parser._geometry import evaluate, preset_geometry
from fastapi.testclient import TestClient
from PIL import Image
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.util import Emu

_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
_P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
_R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_NS = (
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
)
_RECT = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'

# ------------------------------------------------------------------------------------ builders


def _xml(fragment: str) -> Any:
    return etree.fromstring(f"<root {_NS}>{fragment}</root>")[0]


def _body(paragraphs: str, body_pr: str = "<a:bodyPr/>", lst: str = "<a:lstStyle/>") -> str:
    return f"<p:txBody>{body_pr}{lst}{paragraphs}</p:txBody>"


def _sp_xml(
    shape_id: int,
    box: tuple[int, int, int, int] | None = (914400, 914400, 1828800, 914400),
    props: str = "",
    body: str = "",
    ph: str = "",
    text_box: bool = False,
    style: str = "",
    geometry: str = _RECT,
    xfrm_attrs: str = "",
    hidden: bool = False,
) -> str:
    """One ``p:sp`` as XML text, without namespace declarations."""
    xfrm = ""
    if box is not None:
        x, y, cx, cy = box
        xfrm = f'<a:xfrm{xfrm_attrs}><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
    hidden_attr = ' hidden="1"' if hidden else ""
    text_box_attr = ' txBox="1"' if text_box else ""
    return (
        f"<p:sp><p:nvSpPr>"
        f'<p:cNvPr id="{shape_id}" name="Shape {shape_id}"{hidden_attr}/>'
        f"<p:cNvSpPr{text_box_attr}/><p:nvPr>{ph}</p:nvPr></p:nvSpPr>"
        f"<p:spPr>{xfrm}{geometry if box is not None else ''}{props}</p:spPr>"
        f"{style}{body}</p:sp>"
    )


def _sp(shape_id: int, **kwargs: Any) -> Any:
    return _xml(_sp_xml(shape_id, **kwargs))


def _add(container: Any, element: Any) -> Any:
    container.shapes._spTree.append(element)
    return element


def _edit_theme(prs: Any, edit: Callable[[Any], None]) -> None:
    part = prs.slide_masters[0].part.part_related_by(RT.THEME)
    root = etree.fromstring(part.blob)
    edit(root)
    part._blob = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def _set_fonts(prs: Any, major: str, minor: str) -> None:
    def edit(root: Any) -> None:
        root.find(f".//{_A}majorFont/{_A}latin").set("typeface", major)
        root.find(f".//{_A}minorFont/{_A}latin").set("typeface", minor)

    _edit_theme(prs, edit)


def _theme_color(prs: Any, slot: str) -> str:
    part = prs.slide_masters[0].part.part_related_by(RT.THEME)
    element = etree.fromstring(part.blob).find(f".//{_A}clrScheme/{_A}{slot}")[0]
    return (element.get("lastClr") or element.get("val") or "").upper()


def _save(prs: Any, path: Path) -> Path:
    prs.save(str(path))
    return path


def _title(slide: Any) -> Any:
    title = slide.shapes.title
    assert title is not None
    return title


def _blank(prs: Any) -> Any:
    return prs.slides.add_slide(prs.slide_layouts[6])


def _elements(slide: dict[str, Any], kind: str | None = None) -> list[dict[str, Any]]:
    return [e for e in slide["elements"] if kind is None or e["kind"] == kind]


def _by_source(slide: dict[str, Any], shape_id: int) -> list[dict[str, Any]]:
    return [e for e in slide["elements"] if e["sourceShapeId"] == shape_id]


def _png(color: tuple[int, int, int]) -> BytesIO:
    buffer = BytesIO()
    Image.new("RGB", (8, 8), color).save(buffer, format="PNG")
    buffer.seek(0)
    return buffer


def _hex(rgb: tuple[float, float, float]) -> str:
    return "".join(f"{round(max(0.0, min(1.0, c)) * 255):02X}" for c in rgb)


def _rgb(value: str) -> tuple[float, float, float]:
    return (int(value[0:2], 16) / 255, int(value[2:4], 16) / 255, int(value[4:6], 16) / 255)


def _lum_mod(value: str, factor: float) -> str:
    hue, lightness, saturation = colorsys.rgb_to_hls(*_rgb(value))
    return _hex(colorsys.hls_to_rgb(hue, lightness * factor, saturation))


def _shade(value: str, factor: float) -> str:
    def linear(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    def gamma(c: float) -> float:
        return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055

    r, g, b = _rgb(value)
    return _hex((gamma(linear(r) * factor), gamma(linear(g) * factor), gamma(linear(b) * factor)))


def _hex_of(value: str, path: Path) -> str:
    """A SlideIR colour as hex: a palette role through the deck's own palette."""
    palette = {entry["role"]: entry["hex"].upper() for entry in design_system_of(path)["palette"]}
    return palette.get(value, value.upper())


def _paragraph(text: str, rpr: str = "", ppr: str = "") -> str:
    return f'<a:p>{ppr}<a:r><a:rPr lang="en-US"{rpr}</a:rPr><a:t>{text}</a:t></a:r></a:p>'


# ------------------------------------------------------------------------------------ inheritance


def test_placeholder_inherits_position_and_style_from_layout_and_master(tmp_path: Path) -> None:
    prs = Presentation()
    _set_fonts(prs, "Major Face", "Minor Face")
    master = prs.slide_masters[0]._element
    title_run = master.find(f"{_P}txStyles/{_P}titleStyle/{_A}lvl1pPr/{_A}defRPr")
    title_run.set("sz", "4000")
    title_run.set("b", "1")
    body_level = master.find(f"{_P}txStyles/{_P}bodyStyle/{_A}lvl1pPr")
    layout = prs.slide_layouts[1]
    layout_body = next(p for p in layout.placeholders if p.placeholder_format.idx == 1)
    layout_body._element.find(f"{_P}txBody/{_A}lstStyle").append(
        _xml('<a:lvl1pPr><a:defRPr sz="2222"/></a:lvl1pPr>')
    )
    slide = prs.slides.add_slide(layout)
    _title(slide).text = "Heading"
    body_placeholder: Any = slide.placeholders[1]
    body_placeholder.text = "Point"
    expected_title_box = _title(slide)
    path = _save(prs, tmp_path / "deck.pptx")

    [ir] = import_deck(path)
    title = next(e for e in ir["elements"] if e["role"] == "title")
    assert title["box"] == {
        "x": expected_title_box.left,
        "y": expected_title_box.top,
        "cx": expected_title_box.width,
        "cy": expected_title_box.height,
    }
    run = title["paragraphs"][0]["runs"][0]
    assert (run["sizePt"], run["bold"], run["font"]) == (40.0, True, "Major Face")

    body = next(e for e in ir["elements"] if e["role"] == "body")
    paragraph = body["paragraphs"][0]
    # The layout's list style wins over the master's body style; the rest comes from the master.
    assert paragraph["runs"][0]["sizePt"] == 22.22
    assert paragraph["runs"][0]["font"] == "Minor Face"
    assert paragraph["bullet"] == body_level.find(f"{_A}buChar").get("char")
    assert paragraph["marginEmu"] == int(body_level.get("marL"))
    assert paragraph["indentEmu"] == int(body_level.get("indent"))
    # Date, footer and number placeholders of the layout are not drawn on a slide without them.
    assert {e["role"] for e in ir["elements"]} == {"title", "body"}


def test_an_empty_placeholder_is_not_drawn(tmp_path: Path) -> None:
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    _title(slide).text = "Only a title"
    [ir] = import_deck(_save(prs, tmp_path / "deck.pptx"))
    assert [e["role"] for e in ir["elements"]] == ["title"]


def test_theme_font_references_resolve_to_theme_faces(tmp_path: Path) -> None:
    prs = Presentation()
    _set_fonts(prs, "Major Face", "Minor Face")
    slide = _blank(prs)
    body = _body(
        _paragraph("major", '><a:latin typeface="+mj-lt"/>')
        + _paragraph("minor", '><a:latin typeface="+mn-ea"/>')
        + _paragraph("named", '><a:latin typeface="Named Face"/>')
    )
    _add(slide, _sp(2, props="<a:noFill/>", body=body, text_box=True))
    [ir] = import_deck(_save(prs, tmp_path / "deck.pptx"))
    fonts = [p["runs"][0]["font"] for p in _elements(ir, "text")[0]["paragraphs"]]
    assert fonts == ["Major Face", "Minor Face", "Named Face"]


def test_scheme_colour_goes_through_the_colour_map_and_its_transforms(tmp_path: Path) -> None:
    prs = Presentation()
    slide = _blank(prs)
    mapping = (
        'bg1="lt1" tx1="accent2" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" '
        'accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" '
        'hlink="hlink" folHlink="folHlink"'
    )
    override = slide._element.find(f"{_P}clrMapOvr")
    if override is None:
        override = etree.SubElement(slide._element, f"{_P}clrMapOvr")
    for child in list(override):
        override.remove(child)
    override.append(_xml(f"<a:overrideClrMapping {mapping}/>"))
    color = (
        '><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="75000"/></a:schemeClr></a:solidFill>'
    )
    _add(slide, _sp(2, props="<a:noFill/>", body=_body(_paragraph("x", color)), text_box=True))
    [ir] = import_deck(_save(prs, tmp_path / "deck.pptx"))
    run = _elements(ir, "text")[0]["paragraphs"][0]["runs"][0]
    assert run["color"] == _lum_mod(_theme_color(prs, "accent2"), 0.75)


def test_text_without_colour_takes_tx1_through_the_master_map(tmp_path: Path) -> None:
    prs = Presentation()
    _edit_theme(
        prs,
        lambda root: root.find(f".//{_A}clrScheme/{_A}dk1").__setitem__(
            0, _xml('<a:srgbClr val="202122"/>')
        ),
    )
    slide = _blank(prs)
    _add(slide, _sp(2, props="<a:noFill/>", body=_body(_paragraph("x", ">")), text_box=True))
    [ir] = import_deck(_save(prs, tmp_path / "deck.pptx"))
    assert _elements(ir, "text")[0]["paragraphs"][0]["runs"][0]["color"] == "202122"


def test_underline_alignment_anchor_insets_and_line_breaks(tmp_path: Path) -> None:
    prs = Presentation()
    slide = _blank(prs)
    body = _body(
        '<a:p><a:pPr algn="r"/><a:r><a:rPr lang="en-US" sz="1400" u="sng" spc="150"/>'
        '<a:t>first</a:t></a:r><a:br><a:rPr lang="en-US" sz="1400"/></a:br>'
        '<a:r><a:rPr lang="en-US" sz="1400" u="none"/><a:t>second</a:t></a:r></a:p>',
        body_pr='<a:bodyPr anchor="b" lIns="0" tIns="12700" rIns="25400" bIns="38100"/>',
    )
    _add(slide, _sp(2, props="<a:noFill/>", body=body, text_box=True))
    [ir] = import_deck(_save(prs, tmp_path / "deck.pptx"))
    [text] = _elements(ir, "text")
    assert text["verticalAlign"] == "bottom"
    assert text["textInsets"] == {"l": 0, "t": 12700, "r": 25400, "b": 38100}
    paragraph = text["paragraphs"][0]
    assert paragraph["align"] == "right"
    runs = paragraph["runs"]
    assert [r["text"] for r in runs] == ["first", "\n", "second"]
    assert [r["underline"] for r in runs] == [True, False, False]
    assert runs[0]["letterSpacingPt"] == 1.5


def test_insets_and_anchor_default_when_nothing_states_them(tmp_path: Path) -> None:
    prs = Presentation()
    slide = _blank(prs)
    _add(slide, _sp(2, props="<a:noFill/>", body=_body(_paragraph("x", ">")), text_box=True))
    [ir] = import_deck(_save(prs, tmp_path / "deck.pptx"))
    [text] = _elements(ir, "text")
    assert text["verticalAlign"] == "top"
    assert text["textInsets"] == {"l": 91440, "t": 45720, "r": 91440, "b": 45720}


def test_norm_autofit_scales_the_type_and_reduces_line_spacing(tmp_path: Path) -> None:
    prs = Presentation()
    slide = _blank(prs)
    body = _body(
        _paragraph(
            "x", ' sz="2000">', '<a:pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr>'
        ),
        body_pr='<a:bodyPr><a:normAutofit fontScale="50000" lnSpcReduction="20000"/></a:bodyPr>',
    )
    _add(slide, _sp(2, props="<a:noFill/>", body=body, text_box=True))
    unscaled = _body(
        _paragraph("y", ' sz="2000">'), body_pr="<a:bodyPr><a:normAutofit/></a:bodyPr>"
    )
    _add(slide, _sp(3, props="<a:noFill/>", body=unscaled, text_box=True))
    [ir] = import_deck(_save(prs, tmp_path / "deck.pptx"))
    scaled, plain = (_by_source(ir, 2)[0], _by_source(ir, 3)[0])
    assert scaled["paragraphs"][0]["runs"][0]["sizePt"] == 10.0
    assert scaled["paragraphs"][0]["lineSpacing"] == 0.8
    assert plain["paragraphs"][0]["runs"][0]["sizePt"] == 20.0
    assert plain["paragraphs"][0]["lineSpacing"] == 1.0


def test_numbered_bullets_count_per_level_and_restart(tmp_path: Path) -> None:
    prs = Presentation()
    slide = _blank(prs)
    auto = '<a:pPr lvl="{lvl}"><a:buAutoNum type="{kind}"/></a:pPr>'
    paragraphs = (
        _paragraph("one", ">", auto.format(lvl=0, kind="arabicPeriod"))
        + _paragraph("sub", ">", auto.format(lvl=1, kind="alphaLcParenR"))
        + _paragraph("two", ">", auto.format(lvl=0, kind="arabicPeriod"))
        + _paragraph("plain", ">", "<a:pPr><a:buNone/></a:pPr>")
        + _paragraph("again", ">", auto.format(lvl=0, kind="romanUcPeriod"))
        + _paragraph("dot", ">", '<a:pPr><a:buChar char="–"/></a:pPr>')
    )
    _add(slide, _sp(2, props="<a:noFill/>", body=_body(paragraphs), text_box=True))
    [ir] = import_deck(_save(prs, tmp_path / "deck.pptx"))
    bullets = [p.get("bullet") for p in _elements(ir, "text")[0]["paragraphs"]]
    assert bullets == ["1.", "a)", "2.", None, "I.", "–"]


def test_space_before_in_percent_is_measured_against_the_type(tmp_path: Path) -> None:
    prs = Presentation()
    slide = _blank(prs)
    ppr = (
        '<a:pPr><a:spcBef><a:spcPct val="50000"/></a:spcBef>'
        '<a:spcAft><a:spcPts val="600"/></a:spcAft></a:pPr>'
    )
    _add(
        slide,
        _sp(2, props="<a:noFill/>", body=_body(_paragraph("x", ' sz="2000">', ppr)), text_box=True),
    )
    [ir] = import_deck(_save(prs, tmp_path / "deck.pptx"))
    paragraph = _elements(ir, "text")[0]["paragraphs"][0]
    assert (paragraph["spaceBeforePt"], paragraph["spaceAfterPt"]) == (10.0, 6.0)


# ------------------------------------------------------------------------------------- pictures


def test_picture_background_and_pictures_are_written_to_the_media_directory(
    tmp_path: Path,
) -> None:
    prs = Presentation()
    slide = _blank(prs)
    cropped = slide.shapes.add_picture(
        _png((200, 30, 60)), Emu(0), Emu(0), Emu(914400), Emu(914400)
    )
    rid = cropped._element.find(f"{_P}blipFill/{_A}blip").get(f"{_R}embed")
    cropped._element.find(f"{_P}blipFill").insert(1, _xml('<a:srcRect l="10000" t="20000"/>'))
    slide.shapes.add_picture(_png((10, 200, 30)), Emu(914400), Emu(0), Emu(914400), Emu(914400))
    slide._element.find(f"{_P}cSld").insert(
        0,
        _xml(
            f'<p:bg><p:bgPr><a:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/>'
            "</a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>"
        ),
    )
    path = _save(prs, tmp_path / "deck.pptx")
    media = tmp_path / "media"

    [ir] = import_deck(path, media)
    first, second = _elements(ir, "image")
    assert ir["backgroundImage"] == first["mediaPart"]
    assert first["mediaPart"].startswith("/ppt/media/")
    assert _hex_of(ir["background"], path) == "C81E3C"
    assert first["crop"] == {"l": 0.1, "t": 0.2, "r": 0.0, "b": 0.0}
    assert first["fit"] == "cover"
    assert "crop" not in second and second["fit"] == "contain"
    for image in (first, second):
        written = media / Path(image["mediaPart"]).name
        assert written.is_file()
        assert Image.open(written).size == (8, 8)


def test_nothing_is_written_without_a_media_directory(tmp_path: Path) -> None:
    prs = Presentation()
    slide = _blank(prs)
    slide.shapes.add_picture(_png((1, 2, 3)), Emu(0), Emu(0), Emu(914400), Emu(914400))
    path = _save(prs, tmp_path / "deck.pptx")
    import_deck(path)
    assert sorted(p.name for p in tmp_path.iterdir()) == ["deck.pptx"]


# ------------------------------------------------------------------------------------- geometry


def test_guide_formulas_follow_the_specification() -> None:
    env = {"w": 200.0, "h": 100.0, "g": 3.0}
    assert evaluate("*/ w 1 4", env) == 50
    assert evaluate("+- w h 50", env) == 250
    assert evaluate("+/ w h 3", env) == 100
    assert evaluate("?: g 1 2", env) == 1 and evaluate("?: -1 1 2", env) == 2
    assert evaluate("pin 0 250 w", env) == 200 and evaluate("pin 0 -5 w", env) == 0
    assert evaluate("abs -7", env) == 7 and evaluate("sqrt 16", env) == 4
    assert evaluate("max 2 g", env) == 3 and evaluate("min 2 g", env) == 2
    assert evaluate("mod 3 4 0", env) == 5
    assert round(evaluate("cos 100 5400000", env), 6) == 0
    assert round(evaluate("sin 100 5400000", env), 6) == 100
    assert round(evaluate("tan 100 2700000", env), 6) == 100
    assert round(evaluate("at2 0 1", env)) == 5400000
    assert round(evaluate("cat2 10 1 1", env), 4) == round(10 * 2**-0.5, 4)
    assert round(evaluate("sat2 10 1 1", env), 4) == round(10 * 2**-0.5, 4)
    with pytest.raises(ValueError):
        evaluate("nope 1 2", env)


def test_freeform_path_with_an_arc_is_traced_in_the_shape_space(tmp_path: Path) -> None:
    prs = Presentation()
    slide = _blank(prs)
    geometry = (
        '<a:custGeom><a:avLst/><a:gdLst><a:gd name="mid" fmla="*/ 100 1 2"/></a:gdLst>'
        '<a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/><a:pathLst>'
        '<a:path w="100" h="100"><a:moveTo><a:pt x="0" y="mid"/></a:moveTo>'
        '<a:arcTo wR="50" hR="50" stAng="10800000" swAng="10800000"/><a:close/></a:path>'
        '<a:path w="100" h="100" fill="none" stroke="0"><a:moveTo><a:pt x="0" y="0"/></a:moveTo>'
        '<a:lnTo><a:pt x="100" y="100"/></a:lnTo></a:path>'
        "</a:pathLst></a:custGeom>"
    )
    props = '<a:solidFill><a:srgbClr val="123456"/></a:solidFill>'
    _add(slide, _sp(2, box=(0, 0, 1000000, 500000), props=props, geometry=geometry))
    [ir] = import_deck(_save(prs, tmp_path / "deck.pptx"))
    [decor] = _elements(ir, "decor")
    assert "shape" not in decor
    shape_space = decor["geometry"]
    assert (shape_space["width"], shape_space["height"]) == (1000000, 500000)
    arc, line = shape_space["paths"]
    # From the left end of the diameter, half a turn clockwise over the top to the right end.
    assert arc["d"] == "M 0 250000 A 500000 250000 0 0 1 1000000 250000 Z"
    assert (arc["filled"], arc["stroked"]) == (True, True)
    assert line["d"] == "M 0 0 L 1000000 500000"
    assert (line["filled"], line["stroked"]) == (False, False)


def test_a_full_turn_arc_is_split_so_svg_can_draw_it() -> None:
    geometry = preset_geometry("round1Rect", [("adj", "val 50000")], 100, 100)
    assert geometry is not None
    assert geometry["paths"][0]["d"].count(" A ") == 1
    circle_like = preset_geometry("round2SameRect", [("adj1", "val 50000")], 100, 100)
    assert circle_like is not None


def test_chevron_preset_is_traced_from_its_definition(tmp_path: Path) -> None:
    prs = Presentation()
    slide = _blank(prs)
    geometry = (
        '<a:prstGeom prst="chevron"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst>'
        "</a:prstGeom>"
    )
    props = '<a:solidFill><a:srgbClr val="123456"/></a:solidFill>'
    _add(slide, _sp(2, box=(0, 0, 1000000, 500000), props=props, geometry=geometry))
    [ir] = import_deck(_save(prs, tmp_path / "deck.pptx"))
    [decor] = _elements(ir, "decor")
    path = decor["geometry"]["paths"][0]["d"]
    assert path == "M 0 0 L 875000 0 L 1000000 250000 L 875000 500000 L 0 500000 L 125000 250000 Z"


@pytest.mark.parametrize(
    "preset",
    [
        "homePlate",
        "rightArrow",
        "leftArrow",
        "upArrow",
        "downArrow",
        "leftRightArrow",
        "parallelogram",
        "trapezoid",
        "pentagon",
        "hexagon",
        "octagon",
        "rtTriangle",
        "snip1Rect",
        "round1Rect",
        "round2SameRect",
        "plus",
        "star5",
        "flowChartProcess",
        "flowChartDecision",
    ],
)
def test_common_presets_stay_inside_their_box(preset: str) -> None:
    geometry = preset_geometry(preset, [], 2000, 1000)
    assert geometry is not None
    numbers = [
        float(token)
        for token in geometry["paths"][0]["d"].replace(",", " ").split()
        if token not in {"M", "L", "A", "C", "Q", "Z"}
    ]
    assert numbers
    assert all(-0.01 <= n <= 2000.01 for n in numbers)


def test_named_presets_keep_their_name_and_round_rect_its_corner(tmp_path: Path) -> None:
    prs = Presentation()
    slide = _blank(prs)
    fill = '<a:solidFill><a:srgbClr val="123456"/></a:solidFill>'
    round_rect = (
        '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst>'
        "</a:prstGeom>"
    )
    _add(slide, _sp(2, props=fill, geometry=round_rect))
    _add(slide, _sp(3, props=fill, geometry='<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>'))
    [ir] = import_deck(_save(prs, tmp_path / "deck.pptx"))
    rounded, ellipse = _elements(ir, "decor")
    assert (rounded["shape"], rounded["cornerRadius"]) == ("round-rect", 0.25)
    assert ellipse["shape"] == "ellipse" and "geometry" not in ellipse


def test_an_unknown_preset_is_drawn_as_its_box_with_a_warning(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    prs = Presentation()
    slide = _blank(prs)
    fill = '<a:solidFill><a:srgbClr val="123456"/></a:solidFill>'
    _add(slide, _sp(2, props=fill, geometry='<a:prstGeom prst="cloud"><a:avLst/></a:prstGeom>'))
    with caplog.at_level(logging.WARNING, logger="engine.parser.slides"):
        [ir] = import_deck(_save(prs, tmp_path / "deck.pptx"))
    [decor] = _elements(ir, "decor")
    assert "shape" not in decor and "geometry" not in decor
    assert any("cloud" in record.message for record in caplog.records)


# ---------------------------------------------------------------------------------- fill & line


def test_shape_style_references_resolve_against_the_theme(tmp_path: Path) -> None:
    prs = Presentation()
    slide = _blank(prs)
    style = (
        '<p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr>'
        '</a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef>'
        '<a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>'
        '<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>'
    )
    _add(slide, _sp(2, style=style, body=_body(_paragraph("on the shape", ">"))))
    path = _save(prs, tmp_path / "deck.pptx")
    [ir] = import_deck(path)
    [decor] = _elements(ir, "decor")
    accent = _theme_color(prs, "accent1")
    assert _hex_of(decor["fill"], path) == accent
    assert _hex_of(decor["stroke"]["color"], path) == _shade(accent, 0.5)
    theme = etree.fromstring(prs.slide_masters[0].part.part_related_by(RT.THEME).blob)
    second_line = theme.find(f".//{_A}lnStyleLst")[1]
    assert decor["stroke"]["widthEmu"] == int(second_line.get("w"))
    # Words in the shape take the colour of the style's font reference.
    assert decor["paragraphs"][0]["runs"][0]["color"] == _theme_color(prs, "lt1")
    assert decor["verticalAlign"] == "top"


def test_explicit_fill_and_outline_win_over_the_style(tmp_path: Path) -> None:
    prs = Presentation()
    slide = _blank(prs)
    style = (
        '<p:style><a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef>'
        '<a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef>'
        '<a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>'
        '<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>'
    )
    props = "<a:noFill/><a:ln><a:noFill/></a:ln>"
    _add(slide, _sp(2, props=props, style=style, body=_body(_paragraph("words", ">"))))
    [ir] = import_deck(_save(prs, tmp_path / "deck.pptx"))
    # Nothing visible is left of the shape, so only its words are drawn.
    assert [e["kind"] for e in ir["elements"]] == ["text"]


def test_gradient_reads_as_its_mean_and_lines_keep_dash_and_arrows(tmp_path: Path) -> None:
    prs = Presentation()
    slide = _blank(prs)
    gradient = (
        '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="000000"/></a:gs>'
        '<a:gs pos="100000"><a:srgbClr val="FF8040"/></a:gs></a:gsLst></a:gradFill>'
    )
    _add(slide, _sp(2, props=gradient))
    connector = _xml(
        '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="3" name="Line"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>'
        '<p:spPr><a:xfrm flipV="1"><a:off x="0" y="0"/><a:ext cx="914400" cy="0"/></a:xfrm>'
        '<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>'
        '<a:ln w="19050"><a:solidFill><a:srgbClr val="112233"/></a:solidFill>'
        '<a:prstDash val="sysDot"/><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>'
    )
    _add(slide, connector)
    path = _save(prs, tmp_path / "deck.pptx")
    [ir] = import_deck(path)
    panel, line = _elements(ir, "decor")
    assert _hex_of(panel["fill"], path) == "804020"
    assert line["shape"] == "line" and line["flipV"] is True
    assert line["stroke"] == {
        "color": line["stroke"]["color"],
        "widthEmu": 19050,
        "dash": "dot",
        "head": "none",
        "tail": "arrow",
    }
    assert _hex_of(line["stroke"]["color"], path) == "112233"


def test_placeholder_with_a_fill_is_a_panel_under_its_text(tmp_path: Path) -> None:
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[5])
    _title(slide).text = "Banner"
    props = _title(slide)._element.find(f"{_P}spPr")
    props.append(_xml('<a:solidFill><a:srgbClr val="AA0022"/></a:solidFill>'))
    [ir] = import_deck(_save(prs, tmp_path / "deck.pptx"))
    assert [(e["kind"], e["role"]) for e in ir["elements"]] == [
        ("decor", "decoration"),
        ("text", "title"),
    ]
    assert ir["elements"][0]["elementId"].endswith("-shape")


def test_palette_colours_are_named_by_role_and_others_stay_hex(tmp_path: Path) -> None:
    prs = Presentation()
    slide = _blank(prs)
    for shape_id, color in ((2, '<a:schemeClr val="accent1"/>'), (3, '<a:srgbClr val="123457"/>')):
        _add(
            slide,
            _sp(
                shape_id,
                box=(shape_id * 1000000, 0, 900000, 900000),
                props=f"<a:solidFill>{color}</a:solidFill>",
            ),
        )
    path = _save(prs, tmp_path / "deck.pptx")
    palette = {entry["hex"].upper(): entry["role"] for entry in design_system_of(path)["palette"]}
    [ir] = import_deck(path)
    fills = [e["fill"] for e in _elements(ir, "decor")]
    expected = [
        palette.get(hex_value, hex_value) for hex_value in (_theme_color(prs, "accent1"), "123457")
    ]
    assert fills == expected
    assert fills[0] in palette.values()


def test_solid_background_is_a_palette_role_or_hex(tmp_path: Path) -> None:
    prs = Presentation()
    slide = _blank(prs)
    slide._element.find(f"{_P}cSld").insert(
        0,
        _xml(
            '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="0A1B2C"/></a:solidFill>'
            "<a:effectLst/></p:bgPr></p:bg>"
        ),
    )
    path = _save(prs, tmp_path / "deck.pptx")
    [ir] = import_deck(path)
    assert _hex_of(ir["background"], path) == "0A1B2C"
    assert "backgroundImage" not in ir


# ----------------------------------------------------------------------------- groups & layers


def test_groups_are_flattened_through_their_child_space(tmp_path: Path) -> None:
    prs = Presentation()
    slide = _blank(prs)
    fill = '<a:solidFill><a:srgbClr val="123456"/></a:solidFill>'
    inner_shape = _sp_xml(4, box=(100, 100, 200, 200), props=fill)
    rotated = _sp_xml(5, box=(0, 0, 100, 100), props=fill, xfrm_attrs=' rot="5400000" flipH="1"')
    group = _xml(
        '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="2" name="Outer"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
        '<p:grpSpPr><a:xfrm><a:off x="1000" y="2000"/><a:ext cx="2000" cy="2000"/>'
        '<a:chOff x="0" y="0"/><a:chExt cx="1000" cy="1000"/></a:xfrm></p:grpSpPr>'
        '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="3" name="Inner"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
        '<p:grpSpPr><a:xfrm><a:off x="500" y="500"/><a:ext cx="500" cy="500"/>'
        '<a:chOff x="0" y="0"/><a:chExt cx="1000" cy="1000"/></a:xfrm></p:grpSpPr>'
        f"{inner_shape}</p:grpSp>{rotated}</p:grpSp>"
    )
    _add(slide, group)
    _add(slide, _sp(6, props=fill))
    [ir] = import_deck(_save(prs, tmp_path / "deck.pptx"))
    nested, rotated_el, alone = _elements(ir, "decor")
    # Inner child space halves, outer doubles: 100 -> 50 inside, (500 + 50) * 2 + 1000 outside.
    assert nested["box"] == {"x": 2100, "y": 3100, "cx": 200, "cy": 200}
    assert nested["groupIds"] == ["slide-group-2", "slide-group-3"]
    assert rotated_el["groupIds"] == ["slide-group-2"]
    assert rotated_el["box"] == {"x": 1000, "y": 2000, "cx": 200, "cy": 200}
    assert (rotated_el["rotation"], rotated_el["flipH"]) == (90.0, True)
    assert "groupIds" not in alone


def test_hidden_shapes_are_left_out(tmp_path: Path) -> None:
    prs = Presentation()
    slide = _blank(prs)
    fill = '<a:solidFill><a:srgbClr val="123456"/></a:solidFill>'
    _add(slide, _sp(2, props=fill, hidden=True))
    [ir] = import_deck(_save(prs, tmp_path / "deck.pptx"))
    assert ir["elements"] == []


def test_master_and_layout_graphics_sit_under_the_slide_unless_hidden(tmp_path: Path) -> None:
    prs = Presentation()
    fill = '<a:solidFill><a:srgbClr val="123456"/></a:solidFill>'
    master = prs.slide_masters[0]
    layout = prs.slide_layouts[6]
    _add(master, _sp(90, props=fill))
    _add(layout, _sp(91, props=fill))
    shown = prs.slides.add_slide(layout)
    _add(shown, _sp(2, props=fill))
    hidden = prs.slides.add_slide(layout)
    hidden._element.set("showMasterSp", "0")
    _add(hidden, _sp(2, props=fill))
    path = _save(prs, tmp_path / "deck.pptx")

    first, second = import_deck(path)
    assert [e["elementId"] for e in first["elements"]] == ["master-90", "layout-91", "slide-2"]
    assert [e.get("locked") for e in first["elements"]] == [True, True, None]
    assert [e["elementId"] for e in second["elements"]] == ["slide-2"]

    layout._element.set("showMasterSp", "0")
    first, _ = import_deck(_save(prs, tmp_path / "again.pptx"))
    assert [e["elementId"] for e in first["elements"]] == ["layout-91", "slide-2"]


def test_slide_number_field_shows_the_number_of_its_slide(tmp_path: Path) -> None:
    prs = Presentation()
    layout = prs.slide_layouts[6]
    number_ph = next(
        p for p in prs.slide_layouts[1].placeholders if p.placeholder_format.type == 13
    )
    layout._element.find(f"{_P}cSld/{_P}spTree").append(copy.deepcopy(number_ph._element))
    number_idx = number_ph.placeholder_format.idx
    _blank(prs)
    second = _blank(prs)
    field = _xml(
        '<p:sp><p:nvSpPr><p:cNvPr id="5" name="Number"/><p:cNvSpPr><a:spLocks noGrp="1"/>'
        f'</p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="{number_idx}"/>'
        "</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p>"
        '<a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:rPr lang="en-US"/>'
        "<a:t>‹#›</a:t></a:fld></a:p></p:txBody></p:sp>"
    )
    _add(second, field)
    path = _save(prs, tmp_path / "deck.pptx")
    first, numbered = import_deck(path)
    assert first["elements"] == []
    [number] = numbered["elements"]
    assert number["role"] == "page-number"
    assert number["paragraphs"][0]["runs"][0]["text"] == "2"
    assert number["box"] == {
        "x": number_ph.left,
        "y": number_ph.top,
        "cx": number_ph.width,
        "cy": number_ph.height,
    }


# ------------------------------------------------------------------------------ tables & charts


def test_tables_and_charts_come_back_as_their_own_elements(tmp_path: Path) -> None:
    prs = Presentation()
    slide = _blank(prs)
    table = slide.shapes.add_table(3, 2, Emu(0), Emu(0), Emu(2000000), Emu(900000)).table
    for r, row in enumerate([("Year", "Sales"), ("2025", "10"), ("2026", "12")]):
        for c, text in enumerate(row):
            table.cell(r, c).text = text
    table.cell(1, 1).fill.solid()
    table.cell(1, 1).fill.fore_color.rgb = RGBColor(0x12, 0x34, 0x56)
    data = CategoryChartData()
    data.categories = ["Q1", "Q2"]
    data.add_series("Revenue", (1.5, 2.5))
    slide.shapes.add_chart(
        XL_CHART_TYPE.COLUMN_CLUSTERED, Emu(0), Emu(1000000), Emu(3000000), Emu(2000000), data
    )
    [ir] = import_deck(_save(prs, tmp_path / "deck.pptx"))
    [table_el] = _elements(ir, "table")
    assert table_el["headers"] == ["Year", "Sales"]
    assert table_el["rows"] == [["2025", "10"], ["2026", "12"]]
    assert table_el["headerRow"] is True
    assert table_el["cellStyles"][1][1]["fill"] in {"123456"} | {
        e["role"]
        for e in design_system_of(tmp_path / "deck.pptx")["palette"]
        if e["hex"] == "123456"
    }
    [chart] = _elements(ir, "chart")
    assert chart["chartType"] == "column"
    assert chart["categories"] == ["Q1", "Q2"]
    assert chart["series"] == [{"name": "Revenue", "values": [1.5, 2.5]}]


def test_every_imported_slide_matches_the_contract(tmp_path: Path) -> None:
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    _title(slide).text = "Contract"
    notes = slide.notes_slide.notes_text_frame
    assert notes is not None
    notes.text = "Say this"
    [ir] = import_deck(_save(prs, tmp_path / "deck.pptx"))
    SlideIR.model_validate(ir)
    assert (ir["slideId"], ir["index"], ir["variant"]) == ("imported-1", 0, "balanced")
    assert ir["patternId"] == "/ppt/slideLayouts/slideLayout2.xml"
    assert (ir["slideCx"], ir["slideCy"]) == (prs.slide_width, prs.slide_height)
    assert ir["notes"] == "Say this"


# ------------------------------------------------------------------------------------- endpoint


def test_endpoint_reads_a_deck_and_writes_its_pictures(tmp_path: Path) -> None:
    prs = Presentation()
    slide = _blank(prs)
    slide.shapes.add_picture(_png((9, 9, 9)), Emu(0), Emu(0), Emu(914400), Emu(914400))
    path = _save(prs, tmp_path / "deck.pptx")
    response = TestClient(app).post(
        "/v1/deck-import",
        json={"schemaVersion": 1, "pptxPath": str(path), "mediaDir": str(tmp_path / "media")},
    )
    assert response.status_code == 200
    body = DeckImportResponse.model_validate(response.json())
    [image] = [e for e in response.json()["slides"][0]["elements"] if e["kind"] == "image"]
    assert len(body.slides) == 1
    assert (tmp_path / "media" / Path(image["mediaPart"]).name).is_file()
    # Unset optional fields stay absent rather than coming back as null.
    assert (
        "crop" not in image
        and "rotation" not in image
        and "notes" not in response.json()["slides"][0]
    )


def test_endpoint_refuses_a_file_it_cannot_read(tmp_path: Path) -> None:
    broken = tmp_path / "broken.pptx"
    broken.write_bytes(b"not a zip at all")
    client = TestClient(app)
    for target in (broken, tmp_path / "missing.pptx"):
        response = client.post(
            "/v1/deck-import", json={"schemaVersion": 1, "pptxPath": str(target)}
        )
        assert response.status_code == 422
        assert isinstance(response.json()["detail"], str) and response.json()["detail"]
