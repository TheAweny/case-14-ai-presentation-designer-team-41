"""Independent document fixtures with source fidelity and boundary counterexamples."""

import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest
from engine.contracts import MaterialExtractResponse
from engine.parser.materials import MaterialError, extract_material


def request(path: Path, kind: str = "text", **extra: object) -> SimpleNamespace:
    return SimpleNamespace(
        path=str(path), format=kind, offset=0, limit=20, sheet=None, range=None, **extra
    )


def test_unicode_docx_chunks_rejoin_without_changing_a_number(tmp_path: Path) -> None:
    text = "Я" * 11998 + "25 млн 😀"
    path = tmp_path / "material.docx"
    xml = (
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>"
    )
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", xml)
    page = MaterialExtractResponse.model_validate(extract_material(request(path)))
    assert "".join(segment.text for segment in page.segments) == text
    assert all(segment.locator.paragraph == 1 for segment in page.segments)
    assert all(segment.locator.page is None for segment in page.segments)
    assert page.truncated is False


def test_utf16_dtd_is_refused_instead_of_expanding_entities(tmp_path: Path) -> None:
    path = tmp_path / "entities.docx"
    xml = (
        '<?xml version="1.0" encoding="UTF-16"?>'
        '<!DOCTYPE w:document [<!ENTITY injected "fabricated">]>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body><w:p><w:r><w:t>&injected;</w:t></w:r></w:p></w:body></w:document>"
    )
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", xml.encode("utf-16"))
    with pytest.raises(MaterialError) as caught:
        extract_material(request(path))
    assert caught.value.status == 422


def test_csv_table_preserves_multiline_blank_and_formula_as_inert_text(tmp_path: Path) -> None:
    path = tmp_path / "budget.csv"
    path.write_bytes('name,value,unit\n"two\nlines",,"руб"\nformula,"=2+2",руб\n'.encode())
    page = MaterialExtractResponse.model_validate(extract_material(request(path, "table")))
    assert page.table is not None
    cells = {cell.address: cell for cell in page.table.cells}
    assert cells["A2"].value == "two\nlines"
    assert cells["B2"].value is None
    assert cells["B3"].value == "=2+2"
    assert cells["B3"].formula is None
    assert page.truncated is False


def test_xlsx_formula_without_cache_and_large_scientific_value(tmp_path: Path) -> None:
    ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    path = tmp_path / "precision.xlsx"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(
            "xl/workbook.xml",
            f'<workbook xmlns="{ns}" xmlns:r="{rel}">'
            '<sheets><sheet name="Data" sheetId="1" r:id="r1"/></sheets></workbook>',
        )
        archive.writestr(
            "xl/_rels/workbook.xml.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
        )
        archive.writestr(
            "xl/worksheets/sheet1.xml",
            f'<worksheet xmlns="{ns}"><sheetData><row r="1">'
            '<c r="A1"><f>SUM(B1:C1)</f></c><c r="B1"><v>9.007199254740993e15</v></c>'
            '<c r="C1"><f>2+2</f><v>4</v></c></row></sheetData></worksheet>',
        )
    page = MaterialExtractResponse.model_validate(extract_material(request(path, "table")))
    assert page.table is not None
    cells = {cell.address: cell for cell in page.table.cells}
    assert cells["A1"].value is None
    assert cells["A1"].cached is False
    assert cells["B1"].value == "9.007199254740993e15"
    assert cells["C1"].cached is True
    assert cells["C1"].value == 4
