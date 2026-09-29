"""Tables, charts and figures: placed with their data, styled from the template, drawn natively.

A chart that reaches the file as a picture does not count, so the export test reopens the file
and reads the table cells and the chart's own data back out of it.
"""

import shutil
from pathlib import Path
from typing import Any

import pytest
from engine.api import app
from engine.api._profiles import deterministic_profile
from engine.checks import audit_deck
from engine.contracts import DeckPlan, SlideIR
from engine.export import export_pptx
from engine.layout import VARIANTS, build_slide_ir
from engine.parser import template_profile_of
from engine.visuals import draw_visual, style_visuals
from fastapi.testclient import TestClient
from pptx import Presentation

_SOURCE = [{"itemId": "brief", "quote": "Revenue grew to 15 in Q3."}]
_TABLE = {
    "kind": "table",
    "headers": ["Metric", "Q1", "Q2"],
    "rows": [["Revenue", "10", "12"], ["Retention", "91%", "94%"]],
    "sources": _SOURCE,
}
_CHART = {
    "kind": "chart",
    "chartType": "column",
    "categories": ["Q1", "Q2", "Q3"],
    "series": [{"name": "Revenue", "values": [10, 12, 15]}, {"name": "Cost", "values": [8, 9, 9]}],
    "xTitle": "Quarter",
    "yTitle": "Revenue, mln RUB",
    "sources": _SOURCE,
}
_KPI = {
    "kind": "kpi",
    "items": [
        {"value": "94%", "caption": "Retention", "sources": _SOURCE},
        {"value": "+12%", "caption": "Revenue growth", "sources": _SOURCE},
    ],
}


def _plan(*blocks: dict[str, Any], intent: str = "chart") -> DeckPlan:
    return DeckPlan.model_validate(
        {
            "schemaVersion": 1,
            "planId": "plan",
            "briefId": "brief",
            "title": "Deck",
            "language": "en",
            "slides": [
                {
                    "slideId": "s1",
                    "headline": "Revenue grew because retention held",
                    "subhead": "",
                    "intent": intent,
                    "blocks": list(blocks),
                    "speakerNotes": "",
                    "sources": [],
                }
            ],
        }
    )


@pytest.fixture(scope="module")
def template(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("template") / "t.pptx"
    Presentation().save(str(path))
    return path


@pytest.fixture(scope="module")
def profile(template: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    return template_profile_of(template)


def _elements(slide: SlideIR) -> list[dict[str, Any]]:
    return slide.model_dump(mode="json", exclude_unset=True)["elements"]


def test_chart_and_table_are_placed_with_their_data(profile: tuple[dict[str, Any], ...]) -> None:
    design_system, patterns = profile
    (slide,) = build_slide_ir(_plan(_CHART, _TABLE), design_system, patterns)
    by_kind = {e["kind"]: e for e in _elements(slide)}
    chart, table = by_kind["chart"], by_kind["table"]
    assert chart["categories"] == _CHART["categories"]
    assert [s["values"] for s in chart["series"]] == [[10, 12, 15], [8, 9, 9]]
    assert chart["yTitle"] == "Revenue, mln RUB"
    assert table["headers"] == _TABLE["headers"]
    assert table["rows"] == _TABLE["rows"]


def test_figures_become_a_value_over_a_caption(profile: tuple[dict[str, Any], ...]) -> None:
    design_system, patterns = profile
    (slide,) = build_slide_ir(_plan(_KPI, intent="kpi"), design_system, patterns)
    elements = _elements(slide)
    values = [e for e in elements if e["role"] == "kpi-value"]
    captions = [e for e in elements if e["role"] == "kpi-caption"]
    assert [v["paragraphs"][0]["runs"][0]["text"] for v in values] == ["94%", "+12%"]
    assert [c["paragraphs"][0]["runs"][0]["text"] for c in captions] == [
        "Retention",
        "Revenue growth",
    ]
    for value, caption in zip(values, captions, strict=True):
        assert caption["box"]["y"] >= value["box"]["y"] + value["box"]["cy"]


@pytest.mark.parametrize("variant", VARIANTS)
def test_visuals_share_a_slide_with_text_without_colliding(
    profile: tuple[dict[str, Any], ...], variant: str
) -> None:
    design_system, patterns = profile
    plan = _plan({"kind": "paragraph", "text": "Retention held above 90%."}, _CHART)
    slides = build_slide_ir(plan, design_system, patterns, variant)  # type: ignore[arg-type]
    report = audit_deck(
        {
            "deckId": "d",
            "slides": [s.model_dump(mode="json", exclude_unset=True) for s in slides],
            "designSystem": design_system,
            "patternCatalog": patterns,
        },
        "default",
        deterministic_profile("default"),
    )
    broken = {"overlap", "slide-bounds", "text-clipped", "chart-labels", "safe-margins"}
    assert not [f for f in report["findings"] if f["checkId"] in broken]


def test_tables_take_the_look_of_the_template(profile: tuple[dict[str, Any], ...]) -> None:
    design_system, patterns = profile
    (slide,) = build_slide_ir(_plan(_TABLE, intent="table"), design_system, patterns)
    styled = style_visuals([slide.model_dump(mode="json", exclude_unset=True)], design_system)
    table = next(e for e in styled[0]["elements"] if e["kind"] == "table")
    roles = {entry["role"] for entry in design_system["palette"]}
    assert table["headerRow"] is True
    used = {table.get("bandFill"), (table.get("borders") or {}).get("color")}
    used |= {cell["fill"] for row in table.get("cellStyles", []) for cell in row if cell}
    assert used - {None} <= roles
    SlideIR.model_validate(styled[0])


def test_a_template_without_the_roles_gets_no_invented_colours() -> None:
    table = {
        "kind": "table",
        "elementId": "t",
        "role": "table",
        "box": {"x": 0, "y": 0, "cx": 10, "cy": 10},
        "sourceShapeId": None,
        "headers": ["a"],
        "rows": [["1"]],
    }
    slide = {"elements": [table]}
    body = {"role": "body", "font": "Arial", "sizePt": 16, "colorRole": "text"}
    design_system = {"palette": [{"role": "text", "hex": "000000"}], "typeScale": [body]}
    styled = style_visuals([slide], design_system)
    look = styled[0]["elements"][0]
    assert "cellStyles" not in look and "bandFill" not in look and "borders" not in look


def test_no_banding_with_a_fill_the_text_cannot_be_read_on() -> None:
    table = {
        "kind": "table",
        "elementId": "t",
        "role": "table",
        "box": {"x": 0, "y": 0, "cx": 10, "cy": 10},
        "sourceShapeId": None,
        "headers": ["a"],
        "rows": [["1"], ["2"], ["3"], ["4"]],
    }
    body = {"role": "body", "font": "Arial", "sizePt": 16, "colorRole": "text"}
    light_on_light = {
        "palette": [{"role": "text", "hex": "FFFFFF"}, {"role": "surface", "hex": "F0F0F0"}],
        "typeScale": [body],
    }
    look = style_visuals([{"elements": [table]}], light_on_light)[0]["elements"][0]
    assert "bandFill" not in look


def test_export_writes_a_native_table_and_chart(
    template: Path, profile: tuple[dict[str, Any], ...], tmp_path: Path
) -> None:
    design_system, patterns = profile
    slides = build_slide_ir(_plan(_CHART, _TABLE), design_system, patterns)
    out = export_pptx(slides, design_system, template, tmp_path / "deck.pptx", draw_visual)

    shapes = list(Presentation(str(out)).slides[0].shapes)
    table = next(s for s in shapes if getattr(s, "has_table", False)).table  # type: ignore[attr-defined]
    assert [table.cell(0, c).text for c in range(3)] == _TABLE["headers"]
    assert table.cell(2, 2).text == "94%"

    chart = next(s for s in shapes if getattr(s, "has_chart", False)).chart  # type: ignore[attr-defined]
    assert list(chart.plots[0].categories) == _CHART["categories"]
    assert [list(s.values) for s in chart.plots[0].series] == [[10, 12, 15], [8, 9, 9]]
    assert chart.value_axis.axis_title.text_frame.text == "Revenue, mln RUB"
    assert chart.has_legend
    assert not any(s.shape_type == 13 for s in shapes)  # MSO_SHAPE_TYPE.PICTURE


def test_exports_endpoint_writes_pptx_and_pdf(template: Path, tmp_path: Path) -> None:
    design_system, patterns = template_profile_of(template)
    slides = build_slide_ir(_plan(_CHART, _TABLE), design_system, patterns)
    formats = ["pptx", "pdf"] if shutil.which("soffice") else ["pptx"]
    response = TestClient(app).post(
        "/v1/exports",
        json={
            "schemaVersion": 1,
            "templatePath": str(template),
            "variant": "balanced",
            "slides": [s.model_dump(mode="json", exclude_unset=True) for s in slides],
            "outputDir": str(tmp_path),
            # Previews are not part of this request; without them the export needs no renderer.
            "formats": formats,
            "previews": False,
        },
    )
    assert response.status_code == 200, response.text
    written = {f["format"]: Path(f["path"]) for f in response.json()["files"]}
    assert set(written) == set(formats)
    assert all(path.is_file() and path.stat().st_size > 0 for path in written.values())
    assert not (tmp_path / "previews").exists()


def test_exports_render_previews_only_when_asked(template: Path, tmp_path: Path) -> None:
    design_system, patterns = template_profile_of(template)
    slides = build_slide_ir(_plan(_CHART, _TABLE), design_system, patterns)
    payload = {
        "schemaVersion": 1,
        "templatePath": str(template),
        "variant": "balanced",
        "slides": [s.model_dump(mode="json", exclude_unset=True) for s in slides],
        "outputDir": str(tmp_path),
        "formats": ["pptx"],
    }
    # Without a renderer the export still works, it just cannot draw previews.
    response = TestClient(app).post("/v1/exports", json={**payload, "previews": False})
    assert response.status_code == 200, response.text
    assert not (tmp_path / "previews").exists()
    if not (shutil.which("soffice") and shutil.which("pdftoppm")):
        return
    rendered = TestClient(app).post("/v1/exports", json={**payload, "previews": True})
    assert rendered.status_code == 200, rendered.text
    previews = list((tmp_path / "previews").glob("slide-*.png"))
    assert len(previews) == len(slides)


def test_figures_step_down_the_scale_until_they_fit(profile: tuple[dict[str, Any], ...]) -> None:
    design_system, patterns = profile
    many = {
        "kind": "kpi",
        "items": [
            {"value": f"{n} 250", "caption": "Revenue", "sources": _SOURCE} for n in range(1, 5)
        ],
    }
    (slide,) = build_slide_ir(_plan(many, intent="kpi"), design_system, patterns)
    values = [e for e in _elements(slide) if e["role"] == "kpi-value"]
    assert values and all(v["overflow"] is None for v in values)
    largest = max(float(s["sizePt"]) for s in design_system["typeScale"])
    assert values[0]["paragraphs"][0]["runs"][0]["sizePt"] < largest
