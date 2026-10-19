"""KPI, charts and tables from structured input. No model and no invented number."""

from __future__ import annotations

import pytest
from engine.visuals import build_visual
from engine.visuals.audit import audit_visual
from engine.visuals.numbers import require_measured
from visual_samples import (
    LONG_CAPTION,
    category_chart,
    kpi_block,
    mixed_chart,
    present,
    request_for,
    single_chart,
    table_block,
    time_chart,
)


def _text(elements: list[dict]) -> str:
    chunks: list[str] = []
    for element in elements:
        if element["kind"] == "text":
            chunks.extend(
                run["text"] for paragraph in element["paragraphs"] for run in paragraph["runs"]
            )
        elif element["kind"] == "table":
            chunks.extend(element["headers"])
            chunks.extend(cell for row in element["rows"] for cell in row)
    return "\n".join(chunks)


def test_kpi_keeps_zero_negative_large_missing_and_does_not_divide_by_zero() -> None:
    built = build_visual(request_for(kpi_block(), "balanced"))
    text = _text(built["elements"])

    assert "0 шт" in text
    assert "-12,5 %" in text
    assert "1250000000.50 ₽" in text
    assert LONG_CAPTION in text
    assert "нет данных" in text
    assert "единица указана неоднозначно: усл. ед." in text
    assert "сравнение недоступно: нет базы" in text
    assert "относительное сравнение недоступно: база равна нулю" in text
    assert "Δ +8 шт к 2024" in text
    assert "Δ +8" in text and "%" not in text.split("Δ +8 шт к 2024", 1)[1].split("\n", 1)[0]
    assert "unverified" in text
    assert "grounded" not in text
    assert built["issues"] == []
    assert built["deferred"] == ["semantic-planner-binding"]
    assert built["chart"] is None
    value = next(
        element for element in built["elements"] if element["elementId"].endswith("value-7")
    )
    assert value["paragraphs"][0]["runs"][0]["text"] == "нет данных"


def test_three_kpi_topologies_differ_and_share_facts() -> None:
    built = {
        variant: build_visual(request_for(kpi_block(), variant))
        for variant in ("dense", "balanced", "airy")
    }
    digests = {variant: item["signature"]["digest"] for variant, item in built.items()}
    assert len(set(digests.values())) == 3
    texts = {_text(item["elements"]) for item in built.values()}
    assert len(texts) == 1
    assert all(item["issues"] == [] for item in built.values())


def test_missing_font_is_reported_and_not_replaced() -> None:
    built = build_visual(request_for(kpi_block(), font="No Such Brand Face"))
    assert built["fontWarnings"]
    assert built["fontWarnings"][0]["requested"] == "No Such Brand Face"
    assert built["fontWarnings"][0]["resolved"] != "No Such Brand Face"
    fonts = {
        run["font"]
        for element in built["elements"]
        if element["kind"] == "text"
        for paragraph in element["paragraphs"]
        for run in paragraph["runs"]
    }
    assert fonts == {"No Such Brand Face"}


def test_chart_keeps_zero_negative_missing_and_refuses_pie() -> None:
    built = build_visual(request_for(category_chart(), "balanced"))
    chart = next(element for element in built["elements"] if element["kind"] == "chart")
    table = next(element for element in built["elements"] if element["kind"] == "table")
    assert chart["chartType"] in {"column", "bar"}
    assert chart["series"][0]["values"] == [0, -3.5, 12]
    assert chart["series"][1]["values"][1] is None
    assert "млн ₽" in chart["yTitle"]
    assert table["rows"][1][2] == "нет данных"
    assert table["rows"][0][1] == "0"
    assert "План с очень длинным названием ряда" in table["headers"][2]
    assert built["chart"]["pieRejected"] is False
    assert built["issues"] == []

    rejected = build_visual(request_for({**category_chart(), "requestedType": "pie"}, "airy"))
    assert all(element.get("chartType") != "pie" for element in rejected["elements"])
    assert rejected["chart"]["pieRejected"] is True


def test_time_series_with_unequal_steps_uses_an_xy_line_and_not_a_pie() -> None:
    built = build_visual(request_for(time_chart(), "balanced"))
    chart = next(element for element in built["elements"] if element["kind"] == "chart")
    assert chart["chartType"] == "line"
    assert chart["positions"] == [2020, 2021, 2024, 2025]
    assert chart["series"][0]["values"][-1] is None
    assert built["chart"]["nativeAxis"] == "xy"
    assert built["chart"]["pieRejected"] is True
    assert built["chart"]["used"] == ["line"]


def test_one_observation_is_not_a_line() -> None:
    built = build_visual(request_for(single_chart(), "dense"))
    chart = next(element for element in built["elements"] if element["kind"] == "chart")
    assert chart["chartType"] in {"column", "bar"}
    assert "positions" not in chart
    assert chart["series"][0]["values"] == [0]


def test_mixed_units_do_not_share_an_axis() -> None:
    built = build_visual(request_for(mixed_chart(), "balanced"))
    charts = [element for element in built["elements"] if element["kind"] == "chart"]
    assert len(charts) == 2
    assert {charts[0]["series"][0]["unit"], charts[1]["series"][0]["unit"]} == {"млн ₽", "чел."}
    assert all(len(element["series"]) == 1 for element in charts)
    table = next(element for element in built["elements"] if element["kind"] == "table")
    assert table["rows"] == [["A", "2", "10"], ["B", "3", "12"]]
    assert built["chart"]["splitByUnit"] is True
    assert built["issues"] == []


def test_table_keeps_precision_unicode_and_reports_overflow_without_dropping_rows() -> None:
    built = build_visual(request_for(table_block(), "balanced"))
    table = next(element for element in built["elements"] if element["kind"] == "table")
    assert table["rows"][0][1] == "1250000000.50"
    assert table["rows"][1][1] == "-12,5"
    assert table["rows"][2][1] == "0"
    assert table["rows"][3][1] == "нет данных"
    assert "Ёмкость → запас" in table["rows"][0][0]
    assert LONG_CAPTION in table["rows"][3][0]
    assert table["cellStyles"][1][1]["align"] == "right"
    assert table["cellStyles"][1][0]["align"] == "left"
    note = _text(built["elements"])
    assert "Ноль и пропуск" in note
    assert "unverified" in note
    assert len(table["rows"]) == 4

    tiny = {"x": 400_000, "y": 900_000, "cx": 2_000_000, "cy": 400_000}
    overflowed = build_visual(request_for(table_block(), "dense", box=tiny))
    kept = next(element for element in overflowed["elements"] if element["kind"] == "table")
    assert len(kept["rows"]) == 4
    assert overflowed["fit"]["fits"] is False
    assert overflowed["fit"]["overflow"]["code"] in {"table-overflow", "text-overflow"}
    assert all(item["keepsFacts"] is True for item in overflowed["fit"]["adaptations"])


def test_literal_mismatch_and_a_zero_labelled_missing_are_refused() -> None:
    with pytest.raises(ValueError, match="does not match"):
        require_measured(present("2", 3), "sample")
    bad = table_block()
    bad["rows"][0]["cells"][1] = {"text": "0", "missing": True}
    with pytest.raises(ValueError, match="cannot be shown as zero"):
        build_visual(request_for(bad))


def test_audit_flags_a_pie_of_negatives_and_accepts_the_built_chart() -> None:
    built = build_visual(request_for(category_chart()))
    assert audit_visual(category_chart(), built["elements"], built["reading"]) == []
    pie = {
        "kind": "chart",
        "elementId": "bad-pie",
        "role": "chart",
        "box": {"x": 0, "y": 0, "cx": 100, "cy": 100},
        "sourceShapeId": None,
        "chartType": "pie",
        "categories": ["A"],
        "series": [{"name": "Факт", "values": [-1]}],
        "xTitle": "",
        "yTitle": "",
    }
    issues = audit_visual(category_chart(), [pie], {"facts": []})
    assert any(issue["code"] == "pie-unsuitable" for issue in issues)


def test_two_profiles_keep_the_same_signature_for_the_same_variant() -> None:
    first = build_visual(request_for(kpi_block(), "airy", accent="123456"))
    second = build_visual(request_for(kpi_block(), "airy", accent="AA5500", font="DejaVu Sans"))
    assert first["signature"]["digest"] == second["signature"]["digest"]
