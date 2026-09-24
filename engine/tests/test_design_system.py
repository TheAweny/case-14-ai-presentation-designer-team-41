"""The design system is read from the template, trusted only as far as the evidence goes.

Each test builds a small IR by hand, so it pins exactly one property and no template anyone else
owns is needed. The last test runs the whole path, file to validated contract, on the generated
fixtures, which stand in for a template nobody tuned the extractor on.
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from engine.parser import EMU_PER_INCH, design_system_of
from engine.parser._design import build_design_system
from engine.parser._model import (
    Box,
    ColorRef,
    Fill,
    Paragraph,
    Placeholder,
    Run,
    Shape,
    SlideLike,
    TemplateIR,
    ThemeColors,
    ThemeFonts,
)
from lct_tools.fixtures import FIXTURE_BUILDERS, build_all_fixtures

_W, _H = 12_192_000, 6_858_000
_MARGIN = EMU_PER_INCH // 2
_HASH = "0" * 64
_THEME = "/ppt/theme/theme1.xml"
_MASTER = "/ppt/slideMasters/slideMaster1.xml"

_SLOTS = (
    ("dk1", "000000"),
    ("lt1", "FFFFFF"),
    ("dk2", "1F2A44"),
    ("lt2", "EEF1F5"),
    ("accent1", "E6007E"),
    ("accent2", "00A36C"),
)


def _run(text: str, **kw: Any) -> Run:
    return Run(text=text, **kw)


def _text(
    shape_id: int,
    box: Box,
    runs: tuple[Run, ...],
    placeholder: str = "",
    fill: Fill | None = None,
) -> Shape:
    return Shape(
        shape_id=shape_id,
        name=f"shape{shape_id}",
        kind="text",
        box=box,
        placeholder=Placeholder(type=placeholder, idx=None) if placeholder else None,
        paragraphs=(Paragraph(level=0, runs=runs),),
        fill=fill,
    )


def _title(size: float = 40, color: str = "222222", font: str = "Inter") -> Shape:
    box = Box(x=_MARGIN, y=_MARGIN, cx=_W - 2 * _MARGIN, cy=EMU_PER_INCH)
    run = _run("Quarterly results", size_pt=size, bold=True, color=color, font=font)
    return _text(2, box, (run,), placeholder="title")


def _body(size: float = 18, color: str = "222222", font: str = "Inter") -> Shape:
    box = Box(
        x=_MARGIN, y=2 * EMU_PER_INCH, cx=_W - 2 * _MARGIN, cy=_H - 2 * EMU_PER_INCH - _MARGIN
    )
    run = _run(
        "Revenue grew in every region we operate in. " * 3, size_pt=size, color=color, font=font
    )
    return _text(3, box, (run,), placeholder="body")


def _badge(shape_id: int, colour: str, text_colour: str = "FFFFFF") -> Shape:
    """A small filled box with a label: the way templates show their accent."""
    box = Box(x=_W - 3 * EMU_PER_INCH, y=2 * EMU_PER_INCH, cx=2 * EMU_PER_INCH, cy=EMU_PER_INCH)
    run = _run("New", size_pt=14, color=text_colour, font="Inter")
    return _text(shape_id, box, (run,), fill=Fill(kind="solid", color=ColorRef(hex=colour)))


def _logo(shape_id: int = 90, x: int = _W - EMU_PER_INCH - _MARGIN) -> Shape:
    box = Box(x=x, y=_H - _MARGIN - EMU_PER_INCH // 3, cx=EMU_PER_INCH, cy=EMU_PER_INCH // 3)
    return Shape(
        shape_id=shape_id,
        name="Logo",
        kind="picture",
        box=box,
        media_part="/ppt/media/image1.png",
    )


def _template(
    layouts: list[tuple[Shape, ...]],
    master_shapes: tuple[Shape, ...] = (),
    master_background: Fill | None = None,
    fonts: ThemeFonts | None = None,
    slots: tuple[tuple[str, str], ...] = _SLOTS,
) -> TemplateIR:
    master = SlideLike(
        part=_MASTER,
        name="Master",
        shapes=master_shapes,
        background=master_background,
        theme=_THEME,
    )
    return TemplateIR(
        source_name="synthetic.pptx",
        slide_cx=_W,
        slide_cy=_H,
        theme_colors=(ThemeColors(name="Synthetic", slots=slots, part=_THEME),),
        theme_fonts=fonts or ThemeFonts(major_latin="Inter", minor_latin="Inter"),
        masters=(master,),
        layouts=tuple(
            SlideLike(
                part=f"/ppt/slideLayouts/slideLayout{i + 1}.xml",
                name=f"Layout {i + 1}",
                follows=_MASTER,
                shapes=shapes,
            )
            for i, shapes in enumerate(layouts)
        ),
    )


def _content(n: int = 6, *extra: Shape) -> list[tuple[Shape, ...]]:
    return [(_title(), _body(), *extra) for _ in range(n)]


def _palette(ds: dict[str, Any]) -> dict[str, str]:
    return {p["role"]: p["hex"] for p in ds["palette"]}


def _scale(ds: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {s["role"]: s for s in ds["typeScale"]}


def _codes(ds: dict[str, Any], token_prefix: str = "") -> set[str]:
    return {w["code"] for w in ds["warnings"] if w["token"].startswith(token_prefix)}


def test_semantic_colours_come_from_use_not_from_the_theme_order() -> None:
    # accent1 in the theme is magenta, but every layout draws its badges in blue with white text.
    ir = _template(_content(6, _badge(10, "0055FF")))
    ds = build_design_system(ir, _HASH)
    palette = _palette(ds)
    assert palette["background"] == "FFFFFF"
    assert palette["text"] == "222222"
    assert palette["accent"] == "0055FF"
    assert palette["text-on-accent"] == "FFFFFF"
    accent = next(p for p in ds["palette"] if p["role"] == "accent")
    assert accent["meta"]["source"] == "observed"


def test_theme_references_resolve_through_the_colour_map_and_transforms() -> None:
    # The badge names accent1 darkened to 50 %, and the master's background names bg2, which the
    # colour map sends to lt2. Neither value appears in the file as a literal.
    darkened = ColorRef(scheme="accent1", transforms=(("lumMod", 50000),))
    badge = replace(_badge(10, "000000"), fill=Fill(kind="solid", color=darkened))
    ir = _template(
        _content(6, badge),
        master_background=Fill(kind="solid", color=ColorRef(scheme="bg2")),
    )
    ds = build_design_system(ir, _HASH)
    palette = _palette(ds)
    assert palette["background"] == "EEF1F5"
    # E6007E at half its lightness in HSL.
    assert palette["accent"] == "73003F"


def test_type_scale_takes_each_role_from_its_placeholders() -> None:
    small = _run("Source: annual report", size_pt=11, color="222222", font="Inter")
    note = _text(20, Box(x=_MARGIN, y=_H - _MARGIN, cx=4 * EMU_PER_INCH, cy=_MARGIN // 2), (small,))
    heading = _run("Regional split", size_pt=28, bold=True, color="222222", font="Inter")
    head = _text(
        21, Box(x=_MARGIN, y=EMU_PER_INCH * 2, cx=6 * EMU_PER_INCH, cy=_MARGIN), (heading,)
    )
    ds = build_design_system(_template(_content(6, note, head)), _HASH)
    scale = _scale(ds)
    assert scale["title"]["sizePt"] == 40 and scale["title"]["bold"]
    assert scale["body"]["sizePt"] == 18 and not scale["body"]["bold"]
    assert scale["heading"]["sizePt"] == 28
    assert scale["caption"]["sizePt"] == 11
    sizes = [s["sizePt"] for s in ds["typeScale"]]
    assert sizes == sorted(sizes, reverse=True)


def test_grid_margins_are_where_the_placeholders_sit() -> None:
    ds = build_design_system(_template(_content(6)), _HASH)
    grid = ds["grid"]
    assert grid["marginLeft"] == _MARGIN
    assert grid["marginRight"] == _MARGIN
    assert grid["marginTop"] == _MARGIN
    assert grid["meta"]["source"] == "observed"
    # 18 pt body at the default spacing, in EMU.
    assert grid["baseline"] == round(18 * 1.1 * 12_700)


def test_a_narrow_body_does_not_pass_for_the_right_margin() -> None:
    # Title and body both stop at 60 % of the width, leaving the rest to a picture.
    title = replace(_title(), box=Box(x=_MARGIN, y=_MARGIN, cx=_W * 6 // 10, cy=EMU_PER_INCH))
    body = replace(_body(), box=Box(x=_MARGIN, y=2 * EMU_PER_INCH, cx=_W // 2, cy=EMU_PER_INCH))
    ds = build_design_system(_template([(title, body) for _ in range(6)]), _HASH)
    assert ds["grid"]["marginRight"] == ds["grid"]["marginLeft"] == _MARGIN
    assert "low-confidence" in _codes(ds, "grid.marginRight")


def test_logo_on_the_master_is_protected_and_a_one_off_picture_is_not() -> None:
    footer_box = Box(x=_MARGIN, y=_H - _MARGIN, cx=4 * EMU_PER_INCH, cy=_MARGIN // 2)
    footer = _text(30, footer_box, (), placeholder="footer")
    layouts = _content(6)
    layouts[2] = (
        *layouts[2],
        replace(_logo(91, x=5 * EMU_PER_INCH), media_part="/ppt/media/photo.png"),
    )
    ds = build_design_system(_template(layouts, master_shapes=(_logo(), footer)), _HASH)
    zones = {(z["role"], z["mediaPart"]) for z in ds["protectedZones"]}
    assert ("logo", "/ppt/media/image1.png") in zones
    assert ("footer", "") in zones
    assert all(z["mediaPart"] != "/ppt/media/photo.png" for z in ds["protectedZones"])


def test_a_logo_repeated_across_layouts_is_protected_once() -> None:
    # No logo on the master: the template places it on every layout, a few EMU apart.
    layouts = [
        (*shapes, _logo(90, x=_W - EMU_PER_INCH - _MARGIN + i * 3))
        for i, shapes in enumerate(_content(6))
    ]
    ds = build_design_system(_template(layouts), _HASH)
    logos = [z for z in ds["protectedZones"] if z["role"] == "logo"]
    assert len(logos) == 1
    assert logos[0]["meta"]["count"] == 6


def test_reordering_parts_changes_nothing() -> None:
    layouts = (
        _content(4, _badge(10, "0055FF")) + [(_title(), _body(size=16), _badge(11, "00A36C"))] * 3
    )
    ir = _template(layouts)
    shuffled = replace(ir, layouts=tuple(reversed(ir.layouts)))
    shuffled = replace(
        shuffled,
        layouts=tuple(
            replace(layout, shapes=tuple(reversed(layout.shapes))) for layout in shuffled.layouts
        ),
    )
    assert build_design_system(shuffled, _HASH) == build_design_system(ir, _HASH)


def test_observed_font_overrides_the_theme_and_says_so() -> None:
    ir = _template(_content(6), fonts=ThemeFonts(major_latin="Arial", minor_latin="Arial"))
    ds = build_design_system(ir, _HASH)
    primary = ds["typeFamilies"][0]
    assert (primary["font"], primary["declared"]) == ("Inter", "Arial")
    assert "observed-overrides-theme" in _codes(ds, "type.primary")


def test_text_with_no_stated_colour_falls_back_to_the_theme_with_a_warning() -> None:
    # A dark master, and runs that inherit their colour: the extractor has to look it up.
    layouts = [(_title(color=""), _body(color="")) for _ in range(6)]
    dark = Fill(kind="solid", color=ColorRef(scheme="tx2"))
    ds = build_design_system(_template(layouts, master_background=dark), _HASH)
    surface = next(s for s in ds["surfaces"] if s["tone"] == "dark")
    assert surface["background"] == "1F2A44"
    assert surface["text"] in {"FFFFFF", "EEF1F5"}
    assert "low-confidence" in _codes(ds, "surfaces.dark.text")
    assert "missing-surface" in _codes(ds, "surfaces.light")


def test_template_with_no_text_gets_a_fallback_scale_that_is_marked() -> None:
    ds = build_design_system(_template([() for _ in range(3)]), _HASH)
    assert all(s["meta"]["source"] == "fallback" for s in ds["typeScale"])
    assert "theme-missing" in _codes(ds, "type.body")
    low = {w["token"] for w in ds["warnings"] if w["code"] == "low-confidence"}
    assert {"type.title", "type.body"} <= low


def test_missing_font_is_substituted_and_reported() -> None:
    ir = _template(_content(6), fonts=ThemeFonts(major_latin="Arial", minor_latin="Arial"))
    ds = build_design_system(ir, _HASH, available_fonts=["Arial", "DejaVu Sans"])
    primary = ds["typeFamilies"][0]
    assert primary["font"] == "Arial"
    assert primary["meta"]["source"] == "fallback"
    assert all(s["font"] == "Arial" for s in ds["typeScale"])
    assert "font-unavailable" in _codes(ds, "type.primary")


def test_no_available_fonts_at_all_keeps_the_template_font_and_warns() -> None:
    ds = build_design_system(_template(_content(6)), _HASH, available_fonts=[])
    assert ds["typeFamilies"][0]["font"] == "Inter"
    assert "font-unavailable" in _codes(ds, "type.primary")


def test_thin_evidence_is_visible_as_low_confidence() -> None:
    ds = build_design_system(_template(_content(1, _badge(10, "0055FF"))), _HASH)
    accent = next(p for p in ds["palette"] if p["role"] == "accent")
    assert accent["meta"]["confidence"] < 0.5
    assert "low-confidence" in _codes(ds, "palette.accent")


_PARSEABLE = tuple(n for n in FIXTURE_BUILDERS if n not in {"malformed-xml", "not-a-package"})


@pytest.fixture(scope="module")
def fixtures(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    return build_all_fixtures(tmp_path_factory.mktemp("templates"))


@pytest.mark.parametrize("name", _PARSEABLE)
def test_every_fixture_yields_a_valid_design_system(name: str, fixtures: dict[str, Path]) -> None:
    ds = design_system_of(fixtures[name])
    assert ds["surfaces"] and ds["typeScale"]
    assert design_system_of(fixtures[name]) == ds
