"""The evaluation run: every variant on every style of template is editable, faithful, distinct."""

from pathlib import Path

from lct_tools.evaluate import build_style_templates, evaluate, main


def test_every_variant_on_every_style_meets_the_bar(tmp_path: Path) -> None:
    templates = build_style_templates(tmp_path / "templates")
    assert len(templates) == 3
    scores = evaluate(templates, tmp_path)
    assert len(scores) == 9
    failing = [s for s in scores if not s.ok]
    assert not failing, failing


def test_the_command_reports_a_table_and_passes() -> None:
    assert main([]) == 0
