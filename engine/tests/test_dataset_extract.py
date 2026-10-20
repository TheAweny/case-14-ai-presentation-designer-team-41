"""I read data files without leaving a row out, and without making up a value."""

import io
import json
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest
import xlsxwriter
from engine.dataset import MAX_BYTES, extract_dataset
from engine.dataset.models import Dataset, Sheet


def _write(path: Path, text: str, encoding: str = "utf-8") -> Path:
    path.write_bytes(text.encode(encoding))
    return path


def _values(sheet: Sheet, column: int) -> list[Any]:
    return [row.cells[column].value for row in sheet.rows]


def _codes(dataset: Dataset) -> set[str]:
    return {d.code for d in dataset.diagnostics}


# Delimiters and encodings ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("delimiter", "name"), [(",", "c.csv"), (";", "s.csv"), ("\t", "t.tsv"), ("|", "p.csv")]
)
def test_the_delimiter_is_found_from_the_lines(tmp_path: Path, delimiter: str, name: str) -> None:
    rows = ["Месяц", "Выручка", "Рост"], ["Янв", "42", "5"], ["Фев", "47", "11"]
    text = "\n".join(delimiter.join(row) for row in rows) + "\n"
    sheet = extract_dataset(_write(tmp_path / name, text)).sheets[0]
    assert [c.header for c in sheet.columns] == ["Месяц", "Выручка", "Рост"]
    assert _values(sheet, 1) == [42.0, 47.0]


def test_a_quoted_field_keeps_its_delimiter_and_its_line_breaks(tmp_path: Path) -> None:
    text = 'Имя,Заметка\n"Иванов, И.","первая\nвторая"\nПетров,ok\n'
    sheet = extract_dataset(_write(tmp_path / "q.csv", text)).sheets[0]
    assert _values(sheet, 0) == ["Иванов, И.", "Петров"]
    assert _values(sheet, 1)[0] == "первая\nвторая"


def test_a_windows_1251_file_is_read_and_said_to_be_guessed(tmp_path: Path) -> None:
    path = _write(tmp_path / "w.csv", "Город;Выручка\nМосква;10\nТверь;7\n", "cp1251")
    dataset = extract_dataset(path)
    assert dataset.sheets[0].columns[0].header == "Город"
    assert _values(dataset.sheets[0], 0) == ["Москва", "Тверь"]
    assert "encoding-guessed" in _codes(dataset)


def test_a_byte_order_mark_does_not_end_up_in_the_first_header(tmp_path: Path) -> None:
    path = tmp_path / "b.csv"
    path.write_bytes(b"\xef\xbb\xbfA,B\n1,2\n3,4\n")
    assert extract_dataset(path).sheets[0].columns[0].header == "A"


# Numbers, locales, dates ----------------------------------------------------------------------


@pytest.mark.parametrize("date_1904", [False, True])
def test_workbook_date_epoch_is_preserved(tmp_path: Path, date_1904: bool) -> None:
    path = tmp_path / "epoch.xlsx"
    with xlsxwriter.Workbook(path, {"date_1904": date_1904}) as book:
        sheet = book.add_worksheet("Dates")
        sheet.write(0, 0, "Date")
        sheet.write_datetime(
            1, 0, datetime(2025, 6, 12), book.add_format({"num_format": "yyyy-mm-dd"})
        )
    dataset = extract_dataset(path)
    assert dataset.sheets[0].rows[0].cells[0].value == "2025-06-12"


def test_numbers_are_read_in_the_locale_the_text_shows(tmp_path: Path) -> None:
    text = (
        "Тип;Значение\nрусская;1 234,56\nрусская;22 300\nанглийская;1,234.50\n"
        "доля;12%\nминус;-5,5\n"
    )
    sheet = extract_dataset(_write(tmp_path / "n.csv", text)).sheets[0]
    assert _values(sheet, 1) == [1234.56, 22300.0, 1234.5, 12.0, -5.5]
    assert [row.cells[1].unit for row in sheet.rows] == ["", "", "", "%", ""]


def test_an_ambiguous_number_is_said_so_and_given_no_value(tmp_path: Path) -> None:
    dataset = extract_dataset(
        _write(tmp_path / "a.csv", "Метрика;Значение\nвыручка;1,234\nрост;5\n")
    )
    cell = dataset.sheets[0].rows[0].cells[1]
    assert cell.value == "1,234"
    assert cell.kind == "text"
    assert cell.candidates == [1.234, 1234.0]
    assert "ambiguous-number" in _codes(dataset)


def test_the_column_settles_a_number_that_alone_is_ambiguous(tmp_path: Path) -> None:
    # «1,5» shows the comma is the decimal one, so «1,234» in the same column is 1.234.
    dataset = extract_dataset(_write(tmp_path / "c.csv", "Курс;Значение\nа;1,5\nб;1,234\nв;7,25\n"))
    assert _values(dataset.sheets[0], 1) == [1.5, 1.234, 7.25]
    assert "ambiguous-number" not in _codes(dataset)


@pytest.mark.parametrize("space", [" ", "\u00a0", "\u202f"])
def test_grouped_integers_do_not_vote_for_decimal_separator(tmp_path: Path, space: str) -> None:
    text = f"Name;Value\na;22{space}300\nb;1,5\nc;1,234\n"
    dataset = extract_dataset(_write(tmp_path / "groups.csv", text))
    assert _values(dataset.sheets[0], 1) == [22300.0, 1.5, 1.234]
    assert dataset.sheets[0].columns[1].decimal == ","
    assert "mixed-decimal-separators" not in _codes(dataset)


def test_grouped_integers_leave_an_ambiguous_neighbour_unresolved(tmp_path: Path) -> None:
    dataset = extract_dataset(_write(tmp_path / "groups.csv", "Name;Value\na;22 300\nb;1,234\n"))
    assert dataset.sheets[0].rows[1].cells[1].candidates == [1.234, 1234.0]
    assert dataset.sheets[0].columns[1].decimal == ""


def test_dates_are_iso_where_one_reading_exists_and_left_alone_where_two_do(tmp_path: Path) -> None:
    text = "Когда;Что\n2025-03-04;a\n04.03.2025;b\n04/03/2025;c\n25/03/2025;d\n"
    dataset = extract_dataset(_write(tmp_path / "d.csv", text))
    sheet = dataset.sheets[0]
    assert _values(sheet, 0) == ["2025-03-04", "2025-03-04", "04/03/2025", "2025-03-25"]
    assert [row.cells[0].kind for row in sheet.rows] == ["date", "date", "text", "date"]
    assert sheet.rows[2].cells[0].candidates == ["2025-03-04", "2025-04-03"]
    assert "ambiguous-date" in _codes(dataset)


def test_empty_cells_are_not_zero_and_zero_is_kept(tmp_path: Path) -> None:
    sheet = extract_dataset(_write(tmp_path / "z.csv", "Мес;Продажи\nЯнв;0\nФев;\nМар;5\n")).sheets[
        0
    ]
    assert [c.kind for c in (r.cells[1] for r in sheet.rows)] == ["number", "empty", "number"]
    assert _values(sheet, 1) == [0.0, None, 5.0]


def test_a_text_in_a_numeric_column_keeps_its_text_and_is_reported(tmp_path: Path) -> None:
    dataset = extract_dataset(_write(tmp_path / "m.csv", "К;V\nа;10\nб;уточн.\nв;30\nг;40\n"))
    sheet = dataset.sheets[0]
    assert sheet.columns[1].kind == "number"
    assert _values(sheet, 1) == [10.0, "уточн.", 30.0, 40.0]
    assert "mixed-column" in _codes(dataset)


def test_a_table_without_a_header_is_said_to_have_none(tmp_path: Path) -> None:
    dataset = extract_dataset(_write(tmp_path / "h.csv", "1,2\n3,4\n5,6\n"))
    assert dataset.sheets[0].headerRow is None
    assert len(dataset.sheets[0].rows) == 3
    assert "no-header" in _codes(dataset)


def test_ragged_rows_are_padded_and_none_is_dropped(tmp_path: Path) -> None:
    dataset = extract_dataset(_write(tmp_path / "r.csv", "A,B,C\n1,2,3\n4,5\n6,7,8,9\n"))
    assert len(dataset.sheets[0].rows) == 3
    assert "ragged-rows" in _codes(dataset)


# Size ------------------------------------------------------------------------------------------


def test_every_row_of_a_big_table_is_kept(tmp_path: Path) -> None:
    lines = ["N;Value"] + [f"{i};{i * 2}" for i in range(1, 501)]
    sheet = extract_dataset(_write(tmp_path / "big.csv", "\n".join(lines))).sheets[0]
    assert len(sheet.rows) == 500
    assert sheet.rows[-1].row == 501
    assert sheet.range == "A1:B501"
    assert sheet.rows[-1].cells[1].ref == "B501"


def test_a_file_over_the_limit_is_refused_whole(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("engine.dataset.MAX_BYTES", 40)
    dataset = extract_dataset(_write(tmp_path / "huge.csv", "A,B\n" + "1,2\n" * 50))
    assert dataset.status == "failed"
    assert dataset.sheets == []
    assert "too-large" in _codes(dataset)
    assert MAX_BYTES == 50 * 1024 * 1024


# Workbooks -------------------------------------------------------------------------------------


def _workbook(path: Path) -> Path:
    book = xlsxwriter.Workbook(str(path))
    money = book.add_format({"num_format": "0.00"})
    percent = book.add_format({"num_format": "0%"})
    day = book.add_format({"num_format": "dd.mm.yyyy"})
    sales = book.add_worksheet("Продажи")
    sales.write_row(0, 0, ["Дата", "Выручка", "Доля", "Комментарий"])
    for i in range(300):
        sales.write_datetime(i + 1, 0, datetime(2025, 1, 1 + i % 28), day)
        sales.write_number(i + 1, 1, 1000.5 + i, money)
        sales.write_number(i + 1, 2, 0.1 + i / 1000, percent)
    sales.write_string(1, 3, "первая")
    sales.write_number(2, 1, 0, money)
    sales.merge_range(3, 3, 3, 4, "общий", None)
    plan = book.add_worksheet("План")
    plan.write_row(0, 0, ["Квартал", "План"])
    plan.write_row(1, 0, ["I кв.", 100])
    plan.write_row(2, 0, ["II кв.", 120])
    secret = book.add_worksheet("Служебный")
    secret.write_row(0, 0, ["x", "y"])
    secret.write_row(1, 0, [1, 2])
    secret.hide()
    book.close()
    return path


def test_every_sheet_of_a_workbook_is_read_with_its_references(tmp_path: Path) -> None:
    dataset = extract_dataset(_workbook(tmp_path / "w.xlsx"))
    assert [(s.name, s.state) for s in dataset.sheets] == [
        ("Продажи", "visible"),
        ("План", "visible"),
        ("Служебный", "hidden"),
    ]
    sales, plan, _ = dataset.sheets
    assert len(sales.rows) == 300
    assert sales.headerRow == 1
    assert [c.header for c in sales.columns][:3] == ["Дата", "Выручка", "Доля"]
    assert sales.rows[0].cells[0].kind == "date"
    assert sales.rows[0].cells[0].value == "2025-01-01"
    assert sales.rows[0].cells[1].value == 1000.5
    assert sales.rows[0].cells[1].ref == "B2"
    assert _values(plan, 1) == [100.0, 120.0]
    assert plan.range == "A1:B3"
    assert "merged-cells" in _codes(dataset)


def test_a_percentage_cell_is_a_percent_and_a_zero_is_a_zero(tmp_path: Path) -> None:
    sales = extract_dataset(_workbook(tmp_path / "w.xlsx")).sheets[0]
    share = sales.rows[0].cells[2]
    assert (share.kind, share.unit) == ("number", "%")
    assert share.value == pytest.approx(10.0)
    assert sales.rows[1].cells[1].value == 0.0


def _bare_workbook(sheet_xml: str, extra: dict[str, str] | None = None) -> bytes:
    main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    parts = {
        "xl/workbook.xml": f'<workbook xmlns="{main}" xmlns:r="{rel}"><sheets>'
        '<sheet name="Лист" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/'
        'package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/>'
        "</Relationships>",
        "xl/worksheets/sheet1.xml": f'<worksheet xmlns="{main}"><sheetData>{sheet_xml}</sheetData>'
        "</worksheet>",
        **(extra or {}),
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in parts.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def test_a_formula_with_no_stored_result_and_an_error_cell_are_said_so(tmp_path: Path) -> None:
    rows = (
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Имя</t></is></c><c r="B1" t="inlineStr">'
        "<is><t>Сумма</t></is></c></row>"
        '<row r="2"><c r="A2" t="inlineStr"><is><t>а</t></is></c><c r="B2"><f>1+1</f></c></row>'
        '<row r="3"><c r="A3" t="inlineStr"><is><t>б</t></is></c><c r="B3" t="e"><v>#DIV/0!</v></c>'
        "</row>"
        '<row r="4"><c r="A4" t="inlineStr"><is><t>в</t></is></c><c r="B4"><f>2+3</f><v>5</v></c>'
        "</row>"
    )
    path = tmp_path / "f.xlsx"
    path.write_bytes(_bare_workbook(rows))
    dataset = extract_dataset(path)
    sheet = dataset.sheets[0]
    # The error keeps its text and has no value; the formula with no stored result is empty.
    assert _values(sheet, 1) == [None, None, 5.0]
    assert sheet.rows[1].cells[1].raw == "#DIV/0!"
    assert {"formula-without-value", "cell-error"} <= _codes(dataset)


@pytest.mark.parametrize("filled", [False, True])
def test_very_hidden_sheets_remain_hidden(tmp_path: Path, filled: bool) -> None:
    from engine.dataset._build import Raw, build_sheet

    grid = {1: {1: Raw("value")}} if filled else {}
    assert build_sheet(0, "Hidden", grid, [], state="veryHidden").state == "hidden"


def test_shared_and_inline_phonetic_annotations_are_not_display_text(tmp_path: Path) -> None:
    main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    rich = '<r><t>東</t></r><rPh sb="0" eb="1"><t>とう</t></rPh><r><t>京</t></r>'
    rows = (
        f'<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is>{rich}</is></c></row>'
    )
    path = tmp_path / "phonetic.xlsx"
    path.write_bytes(
        _bare_workbook(rows, {"xl/sharedStrings.xml": f'<sst xmlns="{main}"><si>{rich}</si></sst>'})
    )
    cells = extract_dataset(path).sheets[0].rows[0].cells
    assert [(cell.raw, cell.value) for cell in cells] == [("東京", "東京"), ("東京", "東京")]


def test_a_missing_workbook_relationship_part_returns_diagnostics(tmp_path: Path) -> None:
    path = tmp_path / "missing-rels.xlsx"
    with (
        zipfile.ZipFile(io.BytesIO(_bare_workbook(""))) as source,
        zipfile.ZipFile(path, "w") as target,
    ):
        for name in source.namelist():
            if name != "xl/_rels/workbook.xml.rels":
                target.writestr(name, source.read(name))
    dataset = extract_dataset(path)
    assert dataset.status == "failed"
    assert "unreadable" in _codes(dataset)


@pytest.mark.parametrize("padding", ["", "<!--" + " " * 5000 + "-->"])
def test_xml_that_declares_entities_is_refused(tmp_path: Path, padding: str) -> None:
    bomb = '<!DOCTYPE x [<!ENTITY a "aaaa">]><sst xmlns="http://schemas.openxmlformats.org/x"/>'
    path = tmp_path / "e.xlsx"
    path.write_bytes(_bare_workbook("", {"xl/sharedStrings.xml": padding + bomb}))
    dataset = extract_dataset(path)
    assert dataset.status == "failed"
    assert "unreadable" in _codes(dataset)


def test_utf16_xml_entities_are_refused(tmp_path: Path) -> None:
    from engine.dataset._xlsx import WorkbookError, _xml

    content = '<!DOCTYPE x [<!ENTITY a "value">]><x>&a;</x>'.encode("utf-16")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("part.xml", content)
    with (
        zipfile.ZipFile(io.BytesIO(buffer.getvalue())) as archive,
        pytest.raises(WorkbookError, match="declares entities"),
    ):
        _xml(archive, "part.xml")


def test_a_broken_workbook_gives_a_diagnostic_not_an_empty_answer(tmp_path: Path) -> None:
    good = _workbook(tmp_path / "w.xlsx").read_bytes()
    for name, data in {
        "cut.xlsx": good[: len(good) // 2],
        "notzip.xlsx": b"this is not a workbook",
        "empty.xlsx": _bare_workbook("").replace(b"workbook.xml", b"other.xml"),
    }.items():
        path = tmp_path / name
        path.write_bytes(data)
        dataset = extract_dataset(path)
        assert dataset.status == "failed", name
        assert dataset.sheets == [], name
        assert "unreadable" in _codes(dataset), name


def test_the_old_xls_format_is_said_not_to_be_read(tmp_path: Path) -> None:
    path = tmp_path / "old.xls"
    path.write_bytes(b"\xd0\xcf\x11\xe0" + b"\x00" * 64)
    dataset = extract_dataset(path)
    assert dataset.status == "failed"
    assert "unsupported-format" in _codes(dataset)


# JSON and text tables --------------------------------------------------------------------------


def test_a_list_of_records_becomes_a_table_with_the_union_of_its_keys(tmp_path: Path) -> None:
    data = [{"a": 1, "b": "x"}, {"a": None, "c": True}, {"a": 3.5, "b": "y"}]
    dataset = extract_dataset(_write(tmp_path / "r.json", json.dumps(data)))
    sheet = dataset.sheets[0]
    assert [c.header for c in sheet.columns] == ["a", "b", "c"]
    assert _values(sheet, 0) == [1.0, None, 3.5]
    # An explicit null is empty, not zero, and the file's own wording stays in `raw`.
    assert sheet.rows[1].cells[0].raw == "null"
    assert sheet.rows[1].cells[0].kind == "empty"
    assert sheet.rows[1].cells[2].kind == "boolean"
    assert sheet.rows[1].cells[2].value is True


def test_json_shapes_other_than_records_are_tables_too(tmp_path: Path) -> None:
    shapes = {
        "rows.json": [["m", "v"], ["a", 1], ["b", 2]],
        "columns.json": {"columns": ["m", "v"], "rows": [["a", 1], ["b", 2]]},
        "lists.json": {"m": ["a", "b"], "v": [1, 2]},
    }
    for name, shape in shapes.items():
        sheet = extract_dataset(_write(tmp_path / name, json.dumps(shape))).sheets[0]
        assert [c.header for c in sheet.columns] == ["m", "v"], name
        assert _values(sheet, 1) == [1.0, 2.0], name


def test_nested_values_are_kept_as_json_text_and_said_so(tmp_path: Path) -> None:
    dataset = extract_dataset(
        _write(tmp_path / "n.json", json.dumps([{"a": {"x": 1}}, {"a": [1]}]))
    )
    assert _values(dataset.sheets[0], 0) == ['{"x":1}', "[1]"]
    assert "nested-value" in _codes(dataset)


def test_broken_json_and_non_finite_numbers_are_refused(tmp_path: Path) -> None:
    for name, text in {"b.json": '{"a": [1, 2', "nan.json": '[{"a": NaN}]'}.items():
        dataset = extract_dataset(_write(tmp_path / name, text))
        assert dataset.status == "failed", name
        assert "unreadable" in _codes(dataset), name


@pytest.mark.parametrize(
    "text",
    [
        '{"columns":[1],"rows":[[2]]}',
        '{"columns":["x"],"rows":[42]}',
        '[{"x":1e400}]',
        '[{"x":{"nested":1e400}}]',
    ],
)
def test_malformed_tabular_json_is_a_diagnostic_in_api(tmp_path: Path, text: str) -> None:
    from engine.api.app import app
    from fastapi.testclient import TestClient

    path = _write(tmp_path / "bad.json", text)
    response = TestClient(app).post("/v1/dataset-extract", json={"path": str(path)})
    assert response.status_code == 200
    assert response.json()["status"] == "failed"
    assert "unreadable" in {item["code"] for item in response.json()["diagnostics"]}


def test_a_markdown_table_is_read_from_a_text(tmp_path: Path) -> None:
    text = (
        "Итоги\n\n| Метрика | Q3 | Q4 |\n| --- | ---: | ---: |\n"
        "| Выручка | 42 | 55 |\n| Рост | 5% | 11% |\n"
    )
    dataset = extract_dataset(_write(tmp_path / "t.md", text))
    sheet = dataset.sheets[0]
    assert [c.header for c in sheet.columns] == ["Метрика", "Q3", "Q4"]
    assert _values(sheet, 2) == [55.0, 11.0]
    assert [r.cells[2].unit for r in sheet.rows] == ["", "%"]


def test_text_with_no_table_and_binary_data_are_not_tables(tmp_path: Path) -> None:
    prose = extract_dataset(_write(tmp_path / "p.md", "Просто текст без таблицы.\n"))
    assert prose.status == "failed"
    assert "no-table" in _codes(prose)
    blob = tmp_path / "blob.csv"
    blob.write_bytes(bytes(range(256)) * 20)
    assert "unreadable" in _codes(extract_dataset(blob))
    nothing = _write(tmp_path / "e.csv", "")
    assert "empty-file" in _codes(extract_dataset(nothing))


def test_an_empty_file_carries_the_digest_of_its_bytes(tmp_path: Path) -> None:
    import hashlib

    empty = extract_dataset(_write(tmp_path / "e.csv", ""))
    assert empty.source.sha256 == hashlib.sha256(b"").hexdigest()
    filled = extract_dataset(_write(tmp_path / "f.csv", "a,b\n1,2\n"))
    assert filled.source.sha256 == hashlib.sha256(b"a,b\n1,2\n").hexdigest()


def test_prose_in_a_txt_file_is_not_read_as_a_comma_table(tmp_path: Path) -> None:
    text = "Квартал закрыт. Выручка, как и ожидали, выросла.\nДальше — план, сроки и риски.\n"
    dataset = extract_dataset(_write(tmp_path / "note.txt", text))
    assert dataset.status == "failed"
    assert "no-table" in _codes(dataset)


def test_a_txt_file_that_is_a_whole_csv_is_still_a_table(tmp_path: Path) -> None:
    sheet = extract_dataset(_write(tmp_path / "data.txt", "a,b\nx,1\ny,2\n")).sheets[0]
    assert [c.header for c in sheet.columns] == ["a", "b"]
    assert _values(sheet, 1) == [1.0, 2.0]


def test_a_block_pasted_from_a_spreadsheet_is_found_inside_a_text(tmp_path: Path) -> None:
    text = (
        "Привет! Вот цифры | черновик\n\n"
        "Команда | Задачи\n:--- | ---:\nАльфа | 40\nБета | 28\n\n"
        "А это из Excel:\nМесяц\tВыручка\nИюль\t1 204,5\nАвгуст\t1 156,0\n\n"
        "Итог: выручка | клиенты растут.\n"
    )
    dataset = extract_dataset(_write(tmp_path / "pasted.txt", text))
    assert [sheet.name for sheet in dataset.sheets] == ["Table 1", "Table 2"]
    pipes, block = dataset.sheets
    assert [c.header for c in pipes.columns] == ["Команда", "Задачи"]
    assert [c.header for c in block.columns] == ["Месяц", "Выручка"]
    assert _values(block, 1) == [1204.5, 1156.0]


def test_a_text_line_with_a_tab_is_not_a_block_on_its_own(tmp_path: Path) -> None:
    text = "| a | b |\n|---|---|\n| 1 | 2 |\n\nОдна строка\tс табом\n"
    dataset = extract_dataset(_write(tmp_path / "one.md", text))
    assert len(dataset.sheets) == 1


def test_markdown_markup_and_escaped_pipes_do_not_hide_values(tmp_path: Path) -> None:
    text = (
        "| **Дата** | Визиты | Заметка |\n|:---|---:|---|\n"
        "| 01.03.2025 | **1 219** | акция \\| лендинг |\n| 02.03.2025 | `1202` | |\n"
    )
    dataset = extract_dataset(_write(tmp_path / "wiki.md", text))
    sheet = dataset.sheets[0]
    assert [c.header for c in sheet.columns] == ["Дата", "Визиты", "Заметка"]
    assert _values(sheet, 1) == [1219.0, 1202.0]
    assert sheet.rows[0].cells[2].raw == "акция | лендинг"
    assert "markup-removed" in _codes(dataset)


def test_a_plain_markdown_table_reports_no_markup(tmp_path: Path) -> None:
    dataset = extract_dataset(_write(tmp_path / "t.md", "| a | b |\n|---|---|\n| x | 1 |\n"))
    assert "markup-removed" not in _codes(dataset)


@pytest.mark.parametrize("marker", ["—", "-", "н/д", "Н/Д", "n/a", "нет данных", "NaN"])
def test_a_written_gap_is_a_gap_with_its_text_kept(tmp_path: Path, marker: str) -> None:
    dataset = extract_dataset(_write(tmp_path / "g.csv", f"К;V\nа;10\nб;{marker}\nв;0\n"))
    cell = dataset.sheets[0].rows[1].cells[1]
    assert (cell.kind, cell.value, cell.raw) == ("empty", None, marker)
    assert _values(dataset.sheets[0], 1) == [10.0, None, 0.0]
    assert "missing-markers" in _codes(dataset)
    assert "mixed-column" not in _codes(dataset)


def test_a_semicolon_file_with_decimal_commas_and_a_comma_in_its_header(tmp_path: Path) -> None:
    text = "Месяц;Выручка, млн ₽\n2025-01;107,5\n2025-02;115,0\n2025-03;122,5\n"
    sheet = extract_dataset(_write(tmp_path / "ru.csv", text)).sheets[0]
    assert [c.header for c in sheet.columns] == ["Месяц", "Выручка, млн ₽"]
    assert _values(sheet, 1) == [107.5, 115.0, 122.5]


def test_a_comma_file_with_a_quoted_decimal_comma_keeps_its_commas(tmp_path: Path) -> None:
    text = 'Город,Доля,Комментарий\nКазань,"12,5",ок\nСамара,"7,25",ок\n'
    sheet = extract_dataset(_write(tmp_path / "q.csv", text)).sheets[0]
    assert [c.header for c in sheet.columns] == ["Город", "Доля", "Комментарий"]
    assert _values(sheet, 1) == [12.5, 7.25]


def test_title_rows_above_a_table_are_not_its_header(tmp_path: Path) -> None:
    text = "Отчёт по регионам;;\nза 2025 год;;\n\nРегион;План;Факт\nМосква;10;12\nКазань;5;6\n"
    dataset = extract_dataset(_write(tmp_path / "titled.csv", text))
    sheet = dataset.sheets[0]
    assert sheet.headerRow == 4
    assert [c.header for c in sheet.columns] == ["Регион", "План", "Факт"]
    assert [row.cells[0].value for row in sheet.rows] == ["Москва", "Казань"]
    preamble = next(d for d in dataset.diagnostics if d.code == "preamble-rows")
    assert "Отчёт по регионам" in preamble.message and preamble.ref == "1:3"


def test_a_table_that_starts_at_its_header_has_no_preamble(tmp_path: Path) -> None:
    dataset = extract_dataset(_write(tmp_path / "plain.csv", "Регион;План\nМосква;10\nКазань;5\n"))
    assert dataset.sheets[0].headerRow == 1
    assert "preamble-rows" not in _codes(dataset)


def test_a_sparse_table_keeps_its_rows(tmp_path: Path) -> None:
    text = "Раздел;;\nИтоги;;\nРегион;;\nМосква;;\nКазань;;\nСамара;;\nУфа;;\n"
    dataset = extract_dataset(_write(tmp_path / "sparse.csv", text))
    assert "preamble-rows" not in _codes(dataset)
    assert sum(len(sheet.rows) for sheet in dataset.sheets) >= 6


def test_a_totals_row_is_named(tmp_path: Path) -> None:
    text = "Регион;Продажи\nМосква;10\nКазань;5\nСамара;7\nИтого;22\n"
    dataset = extract_dataset(_write(tmp_path / "total.csv", text))
    total = next(d for d in dataset.diagnostics if d.code == "total-row")
    assert total.ref == "A5"
    assert len(dataset.sheets[0].rows) == 4


@pytest.mark.parametrize("last", ["Итоговый регион;9", "Тотальный;9", "Москва-2;9"])
def test_a_last_row_that_only_looks_like_a_total_is_data(tmp_path: Path, last: str) -> None:
    text = f"Регион;Продажи\nМосква;10\nКазань;5\nСамара;7\n{last}\n"
    assert "total-row" not in _codes(extract_dataset(_write(tmp_path / "t.csv", text)))


# The API ---------------------------------------------------------------------------------------


def test_the_api_returns_the_dataset_and_a_404_for_a_missing_file(tmp_path: Path) -> None:
    from engine.api.app import app
    from fastapi.testclient import TestClient

    client = TestClient(app)
    path = _write(tmp_path / "a.csv", "A;B\n1;2\n3;4\n")
    response = client.post("/v1/dataset-extract", json={"path": str(path)})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["sheets"][0]["rows"][1]["cells"][1] == {
        "ref": "B3",
        "raw": "4",
        "kind": "number",
        "value": 4.0,
        "unit": "",
        "candidates": [],
    }
    assert (
        client.post("/v1/dataset-extract", json={"path": str(tmp_path / "no.csv")}).status_code
        == 404
    )
    assert client.post("/v1/dataset-extract", json={"path": "x", "extra": 1}).status_code == 422
