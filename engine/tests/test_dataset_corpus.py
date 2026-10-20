"""I read every file of examples/datasets the way a person meant it, tidy or broken.

Each format there comes twice: a tidy file and one written the way real exports go wrong. The
expectations below are what a reader of the file would say, checked value by value where a slip
would change a chart.
"""

import json
import os
from pathlib import Path
from typing import Any

import pytest
from engine.dataset import extract_dataset
from engine.dataset.models import Dataset, Sheet

CORPUS = Path(__file__).resolve().parents[2] / "examples" / "datasets"
#: Recorded engine answers the API tests render; refreshed with UPDATE_DATASET_FIXTURES=1.
FIXTURES = Path(__file__).resolve().parents[2] / "apps" / "api" / "src" / "materials" / "fixtures"
RECORDED = {
    "sales-channels.json": "json/sales-channels.json",
    "sales-channels-bi-export.json": "json/sales-channels-bi-export.json",
    "revenue-monthly-1c-export.json": "csv/revenue-monthly-1c-export.csv",
    "quarter-report-pasted.json": "txt/quarter-report-pasted.txt",
    "order-checks-dirty.json": "tsv/order-checks-dirty.tsv",
    "regions-report-messy.json": "xlsx/regions-report-messy.xlsx",
    "truncated.json": "invalid/truncated.json",
}


def _read(name: str) -> Dataset:
    return extract_dataset(CORPUS / name)


def _codes(dataset: Dataset) -> set[str]:
    return {d.code for d in dataset.diagnostics}


def _headers(sheet: Sheet) -> list[str | None]:
    return [column.header for column in sheet.columns]


def _kinds(sheet: Sheet) -> list[str]:
    return [str(column.kind) for column in sheet.columns]


def _column(sheet: Sheet, index: int) -> list[Any]:
    return [row.cells[index].value for row in sheet.rows]


def _sheet(dataset: Dataset, name: str) -> Sheet:
    return next(sheet for sheet in dataset.sheets if sheet.name == name)


# Every required kind of data is in the corpus, in more than one format ----------------------

KINDS = {
    "time series": ["csv/revenue-monthly.csv", "csv/revenue-monthly-1c-export.csv"],
    "category comparison": ["xlsx/regions-sales.xlsx", "xlsx/regions-report-messy.xlsx"],
    "shares": ["json/sales-channels.json", "json/sales-channels-bi-export.json"],
    "distribution": ["tsv/order-checks.tsv", "tsv/order-checks-dirty.tsv"],
    "reference table of 200+ rows": ["csv/product-catalog.csv", "xlsx/regions-report-messy.xlsx"],
    "data with gaps": ["md/site-traffic-gaps.md", "md/site-traffic-wiki.md"],
    "text with a table inside": ["txt/quarter-report.txt", "txt/quarter-report-pasted.txt"],
}


@pytest.mark.parametrize("kind", sorted(KINDS))
def test_each_required_kind_of_data_reads_in_every_file_that_holds_it(kind: str) -> None:
    for name in KINDS[kind]:
        dataset = _read(name)
        assert dataset.status in ("ok", "partial"), (name, dataset.diagnostics)
        assert any(sheet.rows for sheet in dataset.sheets), name


def test_every_format_has_a_tidy_and_a_broken_file() -> None:
    files = [p for p in CORPUS.rglob("*") if p.is_file() and p.parent.name != "invalid"]
    by_format: dict[str, int] = {}
    for path in files:
        if path.suffix != ".py" and path.name != "README.md":
            by_format[path.suffix] = by_format.get(path.suffix, 0) + 1
    assert {suffix for suffix, count in by_format.items() if count >= 2} >= {
        ".csv",
        ".tsv",
        ".xlsx",
        ".json",
        ".txt",
        ".md",
    }


# Tidy files ------------------------------------------------------------------------------------


def test_the_monthly_revenue_is_a_dated_series_of_24_months() -> None:
    dataset = _read("csv/revenue-monthly.csv")
    sheet = dataset.sheets[0]
    assert dataset.status == "ok"
    assert _headers(sheet) == ["month", "revenue_mln_rub", "costs_mln_rub"]
    assert _kinds(sheet) == ["date", "number", "number"]
    assert len(sheet.rows) == 24
    assert _column(sheet, 0)[0] == "2024-01-31" and _column(sheet, 0)[-1] == "2025-12-31"


def test_the_regions_workbook_compares_eight_regions_over_two_years() -> None:
    sheet = _read("xlsx/regions-sales.xlsx").sheets[0]
    assert _headers(sheet) == ["Регион", "Продажи 2024, млн ₽", "Продажи 2025, млн ₽"]
    assert _kinds(sheet) == ["text", "number", "number"]
    assert len(sheet.rows) == 8


def test_the_channel_shares_add_up_to_one() -> None:
    sheet = _read("json/sales-channels.json").sheets[0]
    assert _headers(sheet) == ["channel", "share"]
    assert sum(_column(sheet, 1)) == pytest.approx(1.0)


def test_a_thousand_order_checks_are_all_kept() -> None:
    sheet = _read("tsv/order-checks.tsv").sheets[0]
    assert len(sheet.rows) == 1000
    assert _kinds(sheet) == ["text", "text", "number"]
    assert all(isinstance(value, float) and value >= 90 for value in _column(sheet, 2))


def test_the_catalog_has_every_one_of_its_260_rows_and_a_two_level_category() -> None:
    sheet = _read("csv/product-catalog.csv").sheets[0]
    assert len(sheet.rows) == 260
    assert _headers(sheet)[2:4] == ["category", "subcategory"]


def test_traffic_gaps_are_gaps_and_not_zeros() -> None:
    sheet = _read("md/site-traffic-gaps.md").sheets[0]
    visits = _column(sheet, 1)
    assert len(visits) == 28
    assert [day for day, value in enumerate(visits, start=1) if value is None] == [5, 6, 17]
    assert 0 not in visits


def test_the_table_inside_the_quarter_report_is_found_among_its_prose() -> None:
    dataset = _read("txt/quarter-report.txt")
    sheet = dataset.sheets[0]
    assert dataset.status == "ok" and len(dataset.sheets) == 1
    assert _headers(sheet) == ["Команда", "Задачи", "Закрыто", "Доля закрытых"]
    assert _column(sheet, 3) == [87.5, 71.4, 100.0, 63.2]
    assert {row.cells[3].unit for row in sheet.rows} == {"%"}


# Broken files ----------------------------------------------------------------------------------


def test_a_1c_export_in_windows_1251_with_semicolons_titles_and_a_total() -> None:
    dataset = _read("csv/revenue-monthly-1c-export.csv")
    sheet = dataset.sheets[0]
    assert dataset.status == "partial"
    assert {"encoding-guessed", "preamble-rows", "total-row"} <= _codes(dataset)
    assert sheet.headerRow == 3
    assert _headers(sheet) == ["Дата", "Выручка, тыс. руб.", "Расходы, млн руб.", "Комментарий"]
    assert _kinds(sheet)[:3] == ["date", "number", "number"]
    first = sheet.rows[0].cells
    assert (first[0].value, first[1].value, first[2].value) == ("2024-01-31", 115600.0, 75.4)
    total = next(d for d in dataset.diagnostics if d.code == "total-row")
    assert total.ref == f"A{sheet.rows[-1].row}"
    # The total is kept as the file wrote it, so a sum can leave it out knowingly.
    months = [row.cells[1].value for row in sheet.rows[:-1]]
    assert all(isinstance(value, float) for value in months)
    assert sheet.rows[-1].cells[1].value == pytest.approx(
        sum(value for value in months if isinstance(value, float))
    )


def test_hand_kept_checks_with_currencies_refunds_gaps_and_a_typo() -> None:
    dataset = _read("tsv/order-checks-dirty.tsv")
    sheet = dataset.sheets[0]
    checks = _column(sheet, 1)
    assert len(sheet.rows) == 400
    assert {"ragged-rows", "duplicate-header", "missing-markers"} <= _codes(dataset)
    assert "mixed-column" not in _codes(dataset)
    assert sum(1 for value in checks if value is None) == 3
    assert 9_999_999.0 in checks
    assert any(value is not None and value < 0 for value in checks)
    plain = _column(sheet, 2)
    for check, written in zip(checks, plain, strict=True):
        if check is not None and 0 < check < 9_999_999:
            assert check == written
    note = next(row.cells[3].raw for row in sheet.rows if row.cells[1].value == 9_999_999.0)
    assert note == "опечатка оператора,\nпроверить"


def test_an_analysts_workbook_with_a_title_formulas_and_hidden_sheets() -> None:
    dataset = _read("xlsx/regions-report-messy.xlsx")
    names = [sheet.name for sheet in dataset.sheets]
    assert names == ["Отчёт 2025 📊", "служебный", "пустой", "Справочник"]
    report = _sheet(dataset, "Отчёт 2025 📊")
    assert report.headerRow == 3
    assert _headers(report) == ["Регион", "План", "Факт", "Выполнение", "Обновлено", "Комментарий"]
    assert _kinds(report) == ["text", "number", "number", "number", "date", "text"]
    assert len(report.rows) == 8
    assert report.rows[2].cells[1].value is not None  # «312,4» typed as text in the workbook
    assert {row.cells[3].unit for row in report.rows if row.cells[3].value is not None} == {"%"}
    assert {"preamble-rows", "merged-cells", "formula-without-value", "cell-error"} <= _codes(
        dataset
    )
    assert _sheet(dataset, "служебный").state == "hidden"
    assert _sheet(dataset, "пустой").rows == []
    reference = _sheet(dataset, "Справочник")
    assert len(reference.rows) == 300


def test_a_bi_export_with_percent_strings_nulls_and_nested_values() -> None:
    dataset = _read("json/sales-channels-bi-export.json")
    sheet = dataset.sheets[0]
    assert _headers(sheet) == ["Канал", "Доля", "Выручка, млн ₽", "Детали"]
    assert _column(sheet, 0) == ["Онлайн", "Розница", "Партнёры", "Прочее"]
    assert _column(sheet, 1) == [46.0, 31.0, 15.5, 8.5]
    assert {row.cells[1].unit for row in sheet.rows} == {"%"}
    assert _column(sheet, 2) == [1012.4, 682.0, None, 187.0]
    assert {"nested-value", "mixed-decimal-separators"} <= _codes(dataset)


def test_a_messenger_paste_with_a_pipe_table_and_an_excel_block() -> None:
    dataset = _read("txt/quarter-report-pasted.txt")
    assert [sheet.name for sheet in dataset.sheets] == ["Table 1", "Table 2"]
    teams, months = dataset.sheets
    assert _headers(teams) == ["Команда", "Задачи", "Закрыто"]
    assert _column(teams, 2) == [35.0, None, 33.0]
    assert _headers(months) == ["Месяц", "Выручка, млн ₽", "Клиенты"]
    assert _column(months, 1) == [1204.5, 1156.0, 1377.9]


def test_a_wiki_table_with_markup_links_and_gaps_written_three_ways() -> None:
    dataset = _read("md/site-traffic-wiki.md")
    sheet = dataset.sheets[0]
    assert _headers(sheet) == ["Дата", "Визиты", "Заказы", "Заметка"]
    assert _kinds(sheet) == ["date", "number", "number", "text"]
    assert len(sheet.rows) == 28
    visits = _column(sheet, 1)
    assert [day for day, value in enumerate(visits, start=1) if value is None] == [5, 6, 17]
    note = next(row.cells[3].raw for row in sheet.rows if row.cells[3].raw)
    assert "акция «1+1» | [лендинг](https://example.com/promo)" in note
    assert {"markup-removed", "missing-markers"} <= _codes(dataset)
    gaps = _read("md/site-traffic-gaps.md").sheets[0]
    assert visits == _column(gaps, 1)


# Files that are no table say why --------------------------------------------------------------

REFUSED = {
    "invalid/truncated.json": "unreadable",
    "invalid/chart-screenshot.csv": "unreadable",
    "invalid/empty.csv": "empty-file",
    "invalid/legacy.xls": "unsupported-format",
    "invalid/notes-without-table.md": "no-table",
}


@pytest.mark.parametrize("name", sorted(REFUSED))
def test_a_file_that_holds_no_table_is_refused_with_a_reason(name: str) -> None:
    dataset = _read(name)
    assert dataset.status == "failed"
    assert dataset.sheets == []
    assert REFUSED[name] in _codes(dataset)


# Recorded answers for the API tests stay what the engine says ---------------------------------


@pytest.mark.parametrize("fixture", sorted(RECORDED))
def test_the_recorded_answer_is_what_the_engine_says_today(fixture: str) -> None:
    fresh = _read(RECORDED[fixture]).model_dump(mode="json")
    path = FIXTURES / fixture
    if os.environ.get("UPDATE_DATASET_FIXTURES") == "1":
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(fresh, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    assert json.loads(path.read_text(encoding="utf-8")) == fresh, (
        f"{fixture} is stale: run UPDATE_DATASET_FIXTURES=1 uv run pytest {__file__}"
    )
