"""The parser turns any .pptx into an inspectable IR, or says why it cannot.

Fixtures are generated into a temporary directory rather than committed, so these tests never
depend on a template anyone else owns.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from engine.parser import (
    MalformedPresentationError,
    NotAPackageError,
    NotAPresentationError,
    TemplateParseError,
    ir_hash,
    parse_template,
    parse_template_ir,
)
from engine.parser._model import WarningCode
from lct_tools.fixtures import FIXTURE_BUILDERS, build_all_fixtures, build_fixture_template

#: Fixtures that must parse. The two broken ones are asserted separately.
_PARSEABLE = tuple(n for n in FIXTURE_BUILDERS if n not in {"malformed-xml", "not-a-package"})


@pytest.fixture(scope="module")
def fixtures(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    return build_all_fixtures(tmp_path_factory.mktemp("templates"))


@pytest.fixture(scope="module")
def shapes_fixture(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Path]:
    path = build_fixture_template(tmp_path_factory.mktemp("basic") / "template.pptx", layouts=3)
    yield path


def test_every_fixture_is_built(fixtures: dict[str, Path]) -> None:
    """The acceptance criteria ask for at least ten fixtures; keep us honest about that."""
    assert len(fixtures) >= 10
    assert all(path.exists() for path in fixtures.values())


@pytest.mark.parametrize("name", _PARSEABLE)
def test_fixture_parses_without_special_cases(name: str, fixtures: dict[str, Path]) -> None:
    ir = parse_template_ir(fixtures[name])
    assert ir.slide_cx > 0
    assert ir.slide_cy > 0
    assert ir.layouts, "a template always carries layouts"


@pytest.mark.parametrize("name", _PARSEABLE)
def test_parsing_is_repeatable(name: str, fixtures: dict[str, Path]) -> None:
    """Two runs over one file must agree, or a cached profile cannot be trusted."""
    first = parse_template_ir(fixtures[name])
    second = parse_template_ir(fixtures[name])
    assert ir_hash(first) == ir_hash(second)
    assert first.to_dict() == second.to_dict()


def test_hash_ignores_the_file_name(fixtures: dict[str, Path], tmp_path: Path) -> None:
    """The same template saved under another name is the same template."""
    original = fixtures["table"]
    renamed = tmp_path / "renamed.pptx"
    renamed.write_bytes(original.read_bytes())
    assert ir_hash(parse_template_ir(original)) == ir_hash(parse_template_ir(renamed))


def test_groups_are_flattened_and_keep_their_path(fixtures: dict[str, Path]) -> None:
    ir = parse_template_ir(fixtures["groups"])
    shapes = ir.slides[0].shapes
    assert any(shape.kind == "group" for shape in shapes)
    nested = [shape for shape in shapes if len(shape.path) == 2]
    assert nested, "a shape two groups deep must survive flattening"


def test_rotation_and_flip_survive(fixtures: dict[str, Path]) -> None:
    shapes = parse_template_ir(fixtures["rotation"]).slides[0].shapes
    assert any(round(shape.rotation, 1) == 37.5 for shape in shapes)
    assert any(shape.flip_h for shape in shapes)


def test_explicit_colour_is_kept_and_inherited_colour_is_not_invented(
    fixtures: dict[str, Path],
) -> None:
    """An inherited colour stays empty on purpose: the distinction carries information."""
    runs = [
        run
        for shape in parse_template_ir(fixtures["theme-colors"]).slides[0].shapes
        for paragraph in shape.paragraphs
        for run in paragraph.runs
    ]
    assert any(run.color == "0077FF" for run in runs)
    assert any(run.color == "" for run in runs)


def test_placeholders_are_identified(fixtures: dict[str, Path]) -> None:
    ir = parse_template_ir(fixtures["placeholders"])
    placeholders = [s.placeholder for s in ir.slides[0].shapes if s.placeholder is not None]
    assert placeholders, "a slide built on a layout carries placeholders"
    assert any(p.type == "title" or p.type == "center-title" for p in placeholders)


def test_chart_is_described_rather_than_flattened(fixtures: dict[str, Path]) -> None:
    shapes = parse_template_ir(fixtures["chart"]).slides[0].shapes
    charts = [shape for shape in shapes if shape.chart_part]
    assert charts, "a native chart must be reported as a chart"
    assert charts[0].chart_type


def test_table_size_is_reported(fixtures: dict[str, Path]) -> None:
    shapes = parse_template_ir(fixtures["table"]).slides[0].shapes
    tables = [shape.table_size for shape in shapes if shape.table_size is not None]
    assert tables == [(4, 3)]


def test_media_is_inventoried_and_linked_to_the_shape(fixtures: dict[str, Path]) -> None:
    ir = parse_template_ir(fixtures["media"])
    assert len(ir.media) == 1
    item = ir.media[0]
    assert item.bytes > 0
    assert (item.width_px, item.height_px) == (1, 1)
    pictures = [shape for shape in ir.slides[0].shapes if shape.kind == "picture"]
    assert pictures and pictures[0].media_part == item.part


def test_font_named_on_a_run_is_reported_verbatim(fixtures: dict[str, Path]) -> None:
    """A face nobody has installed is still what the template asks for."""
    runs = [
        run
        for shape in parse_template_ir(fixtures["missing-font"]).slides[0].shapes
        for paragraph in shape.paragraphs
        for run in paragraph.runs
    ]
    assert any(run.font == "Nonexistent Brand Grotesk" for run in runs)
    assert any(run.size_pt == 23.0 for run in runs)


def test_odd_aspect_ratio_is_carried_through(fixtures: dict[str, Path]) -> None:
    ir = parse_template_ir(fixtures["odd-aspect"])
    assert (ir.slide_cx, ir.slide_cy) == (7_000_000, 5_000_000)
    assert ir.aspect == "7:5"


def test_malformed_presentation_is_a_named_error(fixtures: dict[str, Path]) -> None:
    with pytest.raises(MalformedPresentationError) as caught:
        parse_template_ir(fixtures["malformed-xml"])
    assert "cannot be interpreted" in str(caught.value)


def test_a_file_that_is_not_a_package_is_a_named_error(fixtures: dict[str, Path]) -> None:
    with pytest.raises(NotAPackageError):
        parse_template_ir(fixtures["not-a-package"])


def test_a_package_without_a_presentation_is_a_named_error(tmp_path: Path) -> None:
    import zipfile

    path = tmp_path / "spreadsheet.pptx"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("xl/workbook.xml", "<workbook/>")
    with pytest.raises(NotAPresentationError):
        parse_template_ir(path)


def test_a_missing_file_is_a_named_error(tmp_path: Path) -> None:
    with pytest.raises(TemplateParseError):
        parse_template_ir(tmp_path / "nothing-here.pptx")


def test_warnings_carry_a_code_and_a_place(shapes_fixture: Path) -> None:
    """Whatever we cannot model must be visible, with enough context to act on."""
    ir = parse_template_ir(shapes_fixture)
    for warning in ir.warnings:
        assert isinstance(warning.code, WarningCode)
        assert warning.message


def test_public_entry_point_returns_a_profile_with_a_hash(shapes_fixture: Path) -> None:
    profile = parse_template(shapes_fixture)
    assert profile["hash"] == ir_hash(parse_template_ir(shapes_fixture))
    assert profile["aspect"]
    assert profile["slide_cx"] > 0
