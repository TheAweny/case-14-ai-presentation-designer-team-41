"""Parser tests for uploaded text and tables. Fixtures are built in the test, not from a dataset."""

from __future__ import annotations

import hashlib
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest
from engine.api.app import app
from engine.contracts import MaterialExtractResponse
from engine.parser.materials import MaterialError, extract_material
from fastapi.testclient import TestClient

NL = chr(10)
TAB = chr(9)


def _request(path: Path, kind: str, **extra: object) -> SimpleNamespace:
    fields: dict[str, object] = {
        "path": str(path),
        "format": kind,
        "offset": 0,
        "limit": 20,
        "sheet": None,
        "range": None,
    }
    fields.update(extra)
    return SimpleNamespace(**fields)


def _parsed(path: Path, kind: str, **extra: object) -> MaterialExtractResponse:
    return MaterialExtractResponse.model_validate(extract_material(_request(path, kind, **extra)))


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_text_pages_paragraphs_and_hash(tmp_path: Path) -> None:
    path = tmp_path / "notes.md"
    path.write_text("First" + NL + NL + "Second" + NL + NL + "Third", encoding="utf-8")
    page = _parsed(path, "text", offset=1, limit=1)
    assert page.sourceSha256 == _sha(path)
    assert page.offset == 1
    assert page.truncated is True
    assert page.nextOffset == 2
    assert page.needsOcr is False
    assert page.table is None
    assert page.segments[0].index == 1
    assert page.segments[0].locator.paragraph == 2
    assert page.segments[0].locator.page is None
    assert page.segments[0].text == "Second"


def test_long_paragraph_keeps_the_same_locator(tmp_path: Path) -> None:
    path = tmp_path / "long.txt"
    path.write_text("a" * 12_001, encoding="utf-8")
    page = _parsed(path, "text", limit=5)
    assert [segment.text for segment in page.segments] == ["a" * 12_000, "a"]
    assert {segment.locator.paragraph for segment in page.segments} == {1}
    assert all(segment.locator.page is None for segment in page.segments)


def test_docx_counts_table_cells_as_paragraphs_without_pages(tmp_path: Path) -> None:
    document = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<document xmlns="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<body><p><r><t>Hello</t></r></p>"
        "<tbl><tr><tc><p><r><t>Cell</t></r></p></tc></tr></tbl>"
        "<p><r><t></t></r></p><p><r><t>After</t></r></p></body></document>"
    )
    path = tmp_path / "note.docx"
    with zipfile.ZipFile(path, "w") as package:
        package.writestr("word/document.xml", document)
    page = _parsed(path, "text")
    found = [(item.locator.paragraph, item.locator.page, item.text) for item in page.segments]
    assert found == [(1, None, "Hello"), (2, None, "Cell"), (4, None, "After")]


def test_csv_keeps_quotes_blanks_and_raw_units(tmp_path: Path) -> None:
    path = tmp_path / "units.csv"
    path.write_bytes(
        ("item,unit" + NL + '"widget","10 кг"' + NL + '"line","a' + NL + 'b"' + NL + ",").encode(
            "utf-8"
        )
    )
    page = _parsed(path, "table", offset=1, limit=1)
    assert page.table is not None
    assert page.offset == 1
    assert page.truncated is True
    assert page.nextOffset == 2
    assert page.segments == []
    values = {(cell.address, cell.value) for cell in page.table.cells}
    assert values == {("A2", "widget"), ("B2", "10 кг")}
    full = _parsed(path, "table", range="A1:B4")
    assert full.table is not None
    blanks = [cell.value for cell in full.table.cells if cell.row == 4]
    assert blanks == [None, None]
    multiline = next(cell for cell in full.table.cells if cell.address == "B3")
    assert multiline.value == "a" + NL + "b"


def test_tsv_and_table_refuses_plain_text(tmp_path: Path) -> None:
    path = tmp_path / "rows.tsv"
    path.write_text("h1" + TAB + "h2" + NL + "1" + TAB + "2" + NL, encoding="utf-8")
    page = _parsed(path, "table")
    assert page.table is not None
    assert [cell.value for cell in page.table.cells] == ["h1", "h2", "1", "2"]
    notes = tmp_path / "notes.txt"
    notes.write_text("hello", encoding="utf-8")
    with pytest.raises(MaterialError) as caught:
        extract_material(_request(notes, "table"))
    assert caught.value.status == 400


def _xlsx(path: Path) -> None:
    q = chr(34)
    ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    pkg = "http://schemas.openxmlformats.org/package/2006/relationships"

    def attr(name: str, value: str) -> str:
        return " " + name + "=" + q + value + q

    def cell(ref: str, inner: str, kind: str | None = None) -> str:
        kind_attr = "" if kind is None else attr("t", kind)
        open_cell = "<c" + attr("r", ref) + kind_attr + ">"
        return open_cell + inner + "</c>"

    decl = "<?xml version=" + q + "1.0" + q
    decl += " encoding=" + q + "UTF-8" + q + "?>"
    workbook_body = "<sheets><sheet" + attr("name", "Q1")
    workbook_body += attr("sheetId", "1")
    workbook_body += attr("r:id", "rId1") + "/></sheets>"
    workbook = decl + "<workbook xmlns=" + q + ns + q
    workbook += " xmlns:r=" + q + rel + q + ">" + workbook_body + "</workbook>"
    rels = decl + "<Relationships xmlns=" + q + pkg + q + "><Relationship"
    rels += attr("Id", "rId1")
    rels += attr("Type", rel + "/worksheet")
    rels += attr("Target", "worksheets/sheet1.xml")
    rels += "/></Relationships>"
    shared = decl + "<sst xmlns=" + q + ns + q + "><si><t>Name</t></si></sst>"
    rows = "<sheetData><row" + attr("r", "1") + ">"
    rows += cell("A1", "<v>0</v>", "s")
    rows += cell("C1", "<f>A1+1</f><v>5</v>")
    rows += "</row><row" + attr("r", "2") + ">"
    rows += cell("A2", "<v>1</v>", "b")
    rows += cell("B2", "<is><t>raw</t></is>", "inlineStr")
    rows += cell("C2", "<v>9007199254740993</v>")
    rows += "</row><row" + attr("r", "3") + ">"
    rows += cell("A3", "<v>9.007199254740993e15</v>")
    rows += cell("B3", "<f>1+1</f>")
    rows += cell("C3", "<v>1e999</v>")
    rows += "</row></sheetData><mergeCells><mergeCell"
    rows += attr("ref", "A1:A2") + "/></mergeCells>"
    sheet = decl + "<worksheet xmlns=" + q + ns + q + ">" + rows + "</worksheet>"
    with zipfile.ZipFile(path, "w") as package:
        package.writestr("xl/workbook.xml", workbook)
        package.writestr("xl/_rels/workbook.xml.rels", rels)
        package.writestr("xl/sharedStrings.xml", shared)
        package.writestr("xl/worksheets/sheet1.xml", sheet)


def test_xlsx_reads_cached_values_without_executing_formulas(tmp_path: Path) -> None:
    path = tmp_path / "book.xlsx"
    _xlsx(path)
    page = _parsed(path, "table", sheet="Q1", range="A1:C3")
    assert page.table is not None
    assert page.table.sheet == "Q1"
    by_address = {cell.address: cell for cell in page.table.cells}
    assert by_address["A1"].value == "Name"
    assert by_address["B1"].value is None
    assert by_address["C1"].formula == "A1+1"
    assert by_address["C1"].cached is True
    assert by_address["C1"].value == 5
    assert by_address["A2"].value is True
    assert by_address["B2"].value == "raw"
    assert by_address["C2"].value == "9007199254740993"
    assert by_address["A3"].value == "9.007199254740993e15"
    assert by_address["B3"].value is None
    assert by_address["B3"].formula == "1+1"
    assert by_address["B3"].cached is False
    assert by_address["C3"].value is None
    warnings = page.model_dump(mode="json")["warnings"]
    assert any("finite" in warning for warning in warnings)
    assert page.model_dump(mode="json")["table"]["mergedRanges"] == ["A1:A2"]


def test_reversed_and_huge_ranges_fail_before_a_wide_read(tmp_path: Path) -> None:
    path = tmp_path / "book.xlsx"
    _xlsx(path)
    with pytest.raises(MaterialError) as reversed_range:
        extract_material(_request(path, "table", range="B2:A1"))
    assert reversed_range.value.status == 400
    with pytest.raises(MaterialError) as huge:
        extract_material(_request(path, "table", range="A1:GS1"))
    assert huge.value.status == 400
    assert "200" in huge.value.detail


def test_missing_file_and_pptx_package(tmp_path: Path) -> None:
    missing = tmp_path / "gone.txt"
    with pytest.raises(MaterialError) as absent:
        extract_material(_request(missing, "text"))
    assert absent.value.status == 404
    deck = tmp_path / "deck.docx"
    with zipfile.ZipFile(deck, "w") as package:
        package.writestr("ppt/presentation.xml", "<presentation/>")
        package.writestr("word/document.xml", "<document/>")
    with pytest.raises(MaterialError) as pptx:
        extract_material(_request(deck, "text"))
    assert pptx.value.status == 422
    assert "PPTX" in pptx.value.detail


def test_xml_dtd_is_refused(tmp_path: Path) -> None:
    path = tmp_path / "evil.docx"
    xml = '<!DOCTYPE foo [<!ENTITY x "no">]><document>&x;</document>'
    with zipfile.ZipFile(path, "w") as package:
        package.writestr("word/document.xml", xml)
    with pytest.raises(MaterialError) as caught:
        extract_material(_request(path, "text"))
    assert caught.value.status == 422


def test_pdf_without_pdftotext_is_a_clear_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "scan.pdf"
    path.write_bytes(b"%PDF-1.1")
    monkeypatch.setattr("engine.parser.materials.shutil.which", lambda _name: None)
    with pytest.raises(MaterialError) as caught:
        extract_material(_request(path, "text"))
    assert caught.value.status == 422
    assert "pdftotext" in caught.value.detail


def test_pdf_over_the_read_limit_is_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "note.pdf"
    path.write_bytes(b"%PDF-1.1")

    def fake_run(args: list[str], _error_path: Path, stdout: Path | None = None) -> None:
        if stdout is not None:
            stdout.write_text("Pages: 1", encoding="utf-8")
            return
        Path(args[-1]).write_bytes(b"abcdef")

    monkeypatch.setattr("engine.parser.materials.shutil.which", lambda _name: "tool")
    monkeypatch.setattr("engine.parser.materials._run_pdf", fake_run)
    monkeypatch.setattr("engine.parser.materials.MAX_PDF_TEXT_BYTES", 3)
    with pytest.raises(MaterialError) as caught:
        extract_material(_request(path, "text"))
    assert caught.value.status == 422
    assert "read limit" in caught.value.detail


def test_utf16_doctype_is_refused(tmp_path: Path) -> None:
    xml = (
        '<?xml version="1.0" encoding="UTF-16"?>'
        '<!DOCTYPE foo [<!ENTITY x "secret">]><document>&x;</document>'
    )
    path = tmp_path / "evil.docx"
    with zipfile.ZipFile(path, "w") as package:
        package.writestr("word/document.xml", xml.encode("utf-16"))
    with pytest.raises(MaterialError) as caught:
        extract_material(_request(path, "text"))
    assert caught.value.status == 422
    assert "DTD" in caught.value.detail


def test_material_route_returns_the_contract(tmp_path: Path) -> None:
    path = tmp_path / "notes.txt"
    path.write_text("Hello", encoding="utf-8")
    response = TestClient(app).post(
        "/v1/material-extract",
        json={
            "schemaVersion": 1,
            "path": str(path),
            "format": "text",
            "offset": 0,
            "limit": 20,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["segments"][0]["text"] == "Hello"
    assert body["sourceSha256"] == _sha(path)
    missing = TestClient(app).post(
        "/v1/material-extract",
        json={
            "schemaVersion": 1,
            "path": str(tmp_path / "missing.txt"),
            "format": "text",
            "offset": 0,
            "limit": 20,
        },
    )
    assert missing.status_code == 404
    rejected = TestClient(app).post(
        "/v1/material-extract",
        json={
            "schemaVersion": 1,
            "path": str(path),
            "format": "table",
            "offset": 0,
            "limit": 20,
        },
    )
    assert rejected.status_code == 400
