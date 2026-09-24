"""The style report shows every token and marks the ones that are guesses."""

from __future__ import annotations

from pathlib import Path

from engine.parser import design_system_of
from lct_tools.fixtures import build_fixture_template
from lct_tools.style_report import render_style_report


def test_report_shows_tokens_zones_and_warnings(tmp_path: Path) -> None:
    ds = design_system_of(build_fixture_template(tmp_path / "template.pptx", layouts=3))
    html = render_style_report(ds, "<template>")

    assert "&lt;template&gt;" in html and "<template>" not in html
    for entry in ds["palette"]:
        assert f"#{entry['hex']}" in html
    for style in ds["typeScale"]:
        assert f"{style['sizePt']:g} pt" in html
    for warning in ds["warnings"]:
        assert warning["token"] in html
    assert html.count("<svg") == 1
