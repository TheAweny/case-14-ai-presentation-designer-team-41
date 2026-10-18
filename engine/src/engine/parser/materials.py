"""Read a slice of an uploaded document. Stdlib only: no model and no presentation package."""

from __future__ import annotations

import csv
import hashlib
import math
import posixpath
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_ZIP_ENTRIES = 2000
MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
MAX_ENTRY_BYTES = 8 * 1024 * 1024
MAX_SEGMENT_CHARS = 12_000
MAX_TABLE_CELLS = 200
MAX_PDF_TEXT_BYTES = 8 * 1024 * 1024
PDF_TIMEOUT_SECONDS = 15
MAX_SAFE_INTEGER = 9007199254740991
MAX_SHEET_ROW = 1_048_576
MAX_SHEET_COLUMN = 16_384

TEXT_EXTENSIONS = {".txt", ".md", ".csv", ".tsv", ".docx", ".xlsx", ".pdf"}
TABLE_EXTENSIONS = {".csv", ".tsv", ".xlsx"}

_CELL_REF = re.compile(r"^([A-Z]{1,3})([1-9][0-9]{0,6})$")
_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_PKG = "{http://schemas.openxmlformats.org/package/2006/relationships}"
Cell = tuple[Any, str | None, bool]
Sheet = tuple[str, str, dict[tuple[int, int], Cell], list[str]]
Box = tuple[int, int, int, int]


class MaterialError(Exception):
    """A material request that should become a 400, 404 or 422, not a traceback."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def extract_material(request: Any) -> dict[str, Any]:
    """Return a MaterialExtractResponse payload for one saved file."""
    path = Path(str(request.path))
    if not path.is_file():
        raise MaterialError(404, "Material file was not found.")
    if path.stat().st_size > MAX_FILE_BYTES:
        raise MaterialError(422, "File is larger than 32 MB.")

    kind = _enum(request.format)
    extension = path.suffix.lower()
    if extension not in TEXT_EXTENSIONS:
        raise MaterialError(422, f"Unsupported material type: {extension or 'unknown'}.")
    if kind == "table" and extension not in TABLE_EXTENSIONS:
        raise MaterialError(400, "Table extraction supports csv, tsv and xlsx only.")

    explicit = _explicit_range(getattr(request, "range", None))
    offset = int(request.offset)
    limit = int(request.limit)
    sheet = getattr(request, "sheet", None)
    digest = _sha256(path)
    warnings: list[str] = []

    if kind == "text":
        segments, needs_ocr = _text_segments(path, extension, sheet, explicit, warnings)
        chosen, truncated, next_offset = _page(segments, offset, limit)
        table = None
    else:
        table, truncated, next_offset = _table_page(
            path, extension, sheet, explicit, offset, limit, warnings
        )
        chosen = []
        needs_ocr = False

    return {
        "schemaVersion": 1,
        "kind": kind,
        "sourceSha256": digest,
        "segments": chosen,
        "table": table,
        "offset": offset,
        "nextOffset": next_offset,
        "truncated": truncated,
        "needsOcr": needs_ocr,
        "warnings": warnings[:20],
    }


def _enum(value: Any) -> str:
    return str(value.value if hasattr(value, "value") else value)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _explicit_range(raw: str | None) -> Box | None:
    parsed = _parse_box(raw)
    if parsed is None:
        return None
    _reject_extreme(parsed)
    return parsed


def _parse_box(raw: str | None) -> Box | None:
    if raw is None:
        return None
    left, _, right = str(raw).partition(":")
    start = _parse_cell(left)
    end = _parse_cell(right)
    if start is None or end is None:
        raise MaterialError(400, "Range must look like A1:B100.")
    c1, r1 = start
    c2, r2 = end
    if r2 < r1 or c2 < c1:
        raise MaterialError(400, "Range is reversed.")
    if r2 > MAX_SHEET_ROW or c2 > MAX_SHEET_COLUMN:
        raise MaterialError(400, "Range is outside the spreadsheet grid.")
    return c1, r1, c2, r2


def _reject_extreme(box: Box) -> None:
    c1, r1, c2, r2 = box
    rows = r2 - r1 + 1
    cols = c2 - c1 + 1
    if rows > MAX_TABLE_CELLS or cols > MAX_TABLE_CELLS or rows * cols > MAX_TABLE_CELLS:
        raise MaterialError(400, "Range has more than 200 cells.")


def _parse_cell(ref: str) -> tuple[int, int] | None:
    match = _CELL_REF.fullmatch(ref)
    if match is None:
        return None
    return _column_index(match.group(1)), int(match.group(2))


def _column_index(letters: str) -> int:
    index = 0
    for letter in letters:
        index = index * 26 + ord(letter) - 64
    return index


def _column_name(index: int) -> str:
    letters: list[str] = []
    while index:
        index, remainder = divmod(index - 1, 26)
        letters.append(chr(65 + remainder))
    return "".join(reversed(letters))


def _a1(column: int, row: int) -> str:
    return f"{_column_name(column)}{row}"


def _range_ref(c1: int, r1: int, c2: int, r2: int) -> str:
    return f"{_a1(c1, r1)}:{_a1(c2, r2)}"


def _page(
    segments: list[dict[str, Any]], offset: int, limit: int
) -> tuple[list[dict[str, Any]], bool, int | None]:
    if offset >= len(segments):
        return [], False, None
    chosen = segments[offset : offset + limit]
    end = offset + len(chosen)
    if end < len(segments):
        return chosen, True, end
    return chosen, False, None


def _add_text(
    segments: list[dict[str, Any]],
    text: str,
    *,
    page: int | None,
    paragraph: int | None,
    sheet: str | None,
    cell_range: str | None,
) -> None:
    if text == "":
        return
    for start in range(0, len(text), MAX_SEGMENT_CHARS):
        segments.append(
            {
                "index": len(segments),
                "locator": {
                    "page": page,
                    "paragraph": paragraph,
                    "sheet": sheet,
                    "range": cell_range,
                },
                "text": text[start : start + MAX_SEGMENT_CHARS],
            }
        )


def _text_segments(
    path: Path,
    extension: str,
    sheet: str | None,
    explicit: Box | None,
    warnings: list[str],
) -> tuple[list[dict[str, Any]], bool]:
    segments: list[dict[str, Any]] = []
    if extension in {".txt", ".md"}:
        for number, paragraph in enumerate(_paragraphs(_read_text(path)), start=1):
            _add_text(segments, paragraph, page=None, paragraph=number, sheet=None, cell_range=None)
        return segments, False
    if extension in {".csv", ".tsv"}:
        _csv_text_segments(segments, path, extension, explicit)
        return segments, False
    if extension == ".docx":
        _docx_segments(segments, path)
        return segments, False
    if extension == ".xlsx":
        _xlsx_text_segments(segments, path, sheet, explicit, warnings)
        return segments, False
    pages, needs_ocr = _pdf_pages(path, warnings)
    for page_number, page in enumerate(pages, start=1):
        for paragraph_number, paragraph in enumerate(_paragraphs(page), start=1):
            _add_text(
                segments,
                paragraph,
                page=page_number,
                paragraph=paragraph_number,
                sheet=None,
                cell_range=None,
            )
    return segments, needs_ocr


def _newline() -> str:
    return chr(10)


def _paragraphs(text: str) -> list[str]:
    newline = _newline()
    normalized = text.replace(chr(13) + newline, newline).replace(chr(13), newline).strip(newline)
    if normalized.strip() == "":
        return []
    parts = re.split(newline + r"[ 	]*" + newline, normalized)
    return [part.strip(newline) for part in parts if part.strip()]


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except UnicodeError as error:
        raise MaterialError(422, "File is not valid UTF-8.") from error


def _csv_rows(path: Path, extension: str) -> list[list[str]]:
    delimiter = chr(9) if extension == ".tsv" else ","
    try:
        with path.open(newline="", encoding="utf-8-sig") as handle:
            return list(csv.reader(handle, delimiter=delimiter))
    except UnicodeError as error:
        raise MaterialError(422, "File is not valid UTF-8.") from error
    except csv.Error as error:
        raise MaterialError(422, f"The table could not be read: {error}") from error


def _csv_text_segments(
    segments: list[dict[str, Any]],
    path: Path,
    extension: str,
    explicit: Box | None,
) -> None:
    delimiter = chr(9) if extension == ".tsv" else ","
    sheet = _sheet_label(path)
    for row_number, row in enumerate(_csv_rows(path, extension), start=1):
        if explicit is not None and not explicit[1] <= row_number <= explicit[3]:
            continue
        if explicit is None:
            cells = row
            start_col = 1
        else:
            cells = row[explicit[0] - 1 : explicit[2]]
            start_col = explicit[0]
        if not any(cell != "" for cell in cells):
            continue
        end_col = start_col + max(len(cells), 1) - 1
        _add_text(
            segments,
            delimiter.join(cells),
            page=None,
            paragraph=None,
            sheet=sheet,
            cell_range=_range_ref(start_col, row_number, end_col, row_number),
        )


def _sheet_label(path: Path) -> str:
    stem = path.stem.strip() or "Sheet1"
    return stem[:200]


def _docx_segments(segments: list[dict[str, Any]], path: Path) -> None:
    with _open_office(path, presentation_forbidden=True) as package:
        if "word/document.xml" not in package.namelist():
            raise MaterialError(422, "The DOCX has no document body.")
        root = _xml(_read_zip(package, "word/document.xml"))
    for paragraph_number, paragraph in enumerate(root.iter(_W + "p"), start=1):
        _add_text(
            segments,
            _docx_paragraph_text(paragraph),
            page=None,
            paragraph=paragraph_number,
            sheet=None,
            cell_range=None,
        )


def _docx_paragraph_text(paragraph: ET.Element) -> str:
    parts: list[str] = []

    def walk(node: ET.Element, top: bool) -> None:
        if not top and node.tag == _W + "p":
            return
        if node.tag == _W + "t" and node.text:
            parts.append(node.text)
        elif node.tag == _W + "tab":
            parts.append(chr(9))
        elif node.tag == _W + "br":
            parts.append(_newline())
        for child in list(node):
            walk(child, False)

    walk(paragraph, True)
    text = "".join(parts)
    return "" if text.strip() == "" else text


def _xlsx_text_segments(
    segments: list[dict[str, Any]],
    path: Path,
    sheet: str | None,
    explicit: Box | None,
    warnings: list[str],
) -> None:
    for name, _target, cells, _merges in _select_sheets(
        _xlsx_sheets(path, warnings), sheet, allow_all=True
    ):
        for row, column in sorted(cells):
            if explicit is not None and not _inside(column, row, explicit):
                continue
            rendered = _render(cells[(row, column)][0])
            if rendered == "":
                continue
            _add_text(
                segments,
                rendered,
                page=None,
                paragraph=None,
                sheet=name,
                cell_range=_range_ref(column, row, column, row),
            )


def _inside(column: int, row: int, box: Box) -> bool:
    c1, r1, c2, r2 = box
    return c1 <= column <= c2 and r1 <= row <= r2


def _render(value: Any) -> str:
    if value is None:
        return ""
    if value is True:
        return "TRUE"
    if value is False:
        return "FALSE"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _table_page(
    path: Path,
    extension: str,
    sheet: str | None,
    explicit: Box | None,
    offset: int,
    limit: int,
    warnings: list[str],
) -> tuple[dict[str, Any], bool, int | None]:
    if extension in {".csv", ".tsv"}:
        return _csv_table(path, extension, explicit, offset, limit)
    return _xlsx_table(path, sheet, explicit, offset, limit, warnings)


def _csv_table(
    path: Path,
    extension: str,
    explicit: Box | None,
    offset: int,
    limit: int,
) -> tuple[dict[str, Any], bool, int | None]:
    rows = _csv_rows(path, extension)
    sheet = _sheet_label(path)
    if explicit is None:
        width = max((len(row) for row in rows), default=0)
        if width == 0 or not rows:
            return _empty_table(sheet, "A1:A1"), False, None
        if width > MAX_TABLE_CELLS:
            raise MaterialError(400, "The sheet is wider than 200 columns; set a range.")
        box: Box = (1, 1, width, len(rows))
    else:
        box = explicit
    return _cells_from_rows(sheet, rows, box, offset, limit)


def _cells_from_rows(
    sheet: str,
    rows: list[list[str]],
    box: Box,
    offset: int,
    limit: int,
) -> tuple[dict[str, Any], bool, int | None]:
    c1, r1, c2, r2 = box
    width = c2 - c1 + 1
    start_row = r1 + offset
    if start_row > r2:
        return _empty_table(sheet, _range_ref(c1, r1, c2, r2)), False, None
    take = min(limit, r2 - start_row + 1, max(1, MAX_TABLE_CELLS // width))
    end_row = start_row + take - 1
    cells = []
    for row_number in range(start_row, end_row + 1):
        source = rows[row_number - 1] if row_number <= len(rows) else []
        for column in range(c1, c2 + 1):
            raw = source[column - 1] if column <= len(source) else ""
            cells.append(_cell(column, row_number, None if raw == "" else raw, None, False))
    truncated = end_row < r2
    table = {
        "sheet": sheet,
        "range": _range_ref(c1, start_row, c2, end_row),
        "cells": cells,
        "mergedRanges": [],
    }
    return table, truncated, (offset + take) if truncated else None


def _empty_table(sheet: str, cell_range: str) -> dict[str, Any]:
    return {"sheet": sheet, "range": cell_range, "cells": [], "mergedRanges": []}


def _cell(column: int, row: int, value: Any, formula: str | None, cached: bool) -> dict[str, Any]:
    return {
        "address": _a1(column, row),
        "row": row,
        "column": column,
        "value": value,
        "formula": formula,
        "cached": cached,
    }


def _xlsx_table(
    path: Path,
    sheet_name: str | None,
    explicit: Box | None,
    offset: int,
    limit: int,
    warnings: list[str],
) -> tuple[dict[str, Any], bool, int | None]:
    name, _target, stored, merges = _select_sheets(
        _xlsx_sheets(path, warnings), sheet_name, allow_all=False
    )[0]
    if explicit is None:
        if not stored:
            return _empty_table(name, "A1:A1"), False, None
        columns = [column for _row, column in stored]
        row_numbers = [row for row, _column in stored]
        box: Box = (min(columns), min(row_numbers), max(columns), max(row_numbers))
        if box[2] - box[0] + 1 > MAX_TABLE_CELLS:
            raise MaterialError(400, "The sheet is wider than 200 columns; set a range.")
    else:
        box = explicit
    c1, r1, c2, r2 = box
    width = c2 - c1 + 1
    start_row = r1 + offset
    if start_row > r2:
        return _empty_table(name, _range_ref(c1, r1, c2, r2)), False, None
    take = min(limit, r2 - start_row + 1, max(1, MAX_TABLE_CELLS // width))
    end_row = start_row + take - 1
    window = (c1, start_row, c2, end_row)
    cells = [
        _cell(column, row, *stored.get((row, column), (None, None, False)))
        for row in range(start_row, end_row + 1)
        for column in range(c1, c2 + 1)
    ]
    table = {
        "sheet": name,
        "range": _range_ref(c1, start_row, c2, end_row),
        "cells": cells,
        "mergedRanges": [ref for ref in merges if _merge_intersects(ref, window)],
    }
    truncated = end_row < r2
    return table, truncated, (offset + take) if truncated else None


def _merge_intersects(ref: str, box: Box) -> bool:
    try:
        parsed = _parse_box(ref)
    except MaterialError:
        return False
    if parsed is None:
        return False
    c1, r1, c2, r2 = parsed
    oc1, or1, oc2, or2 = box
    return c1 <= oc2 and c2 >= oc1 and r1 <= or2 and r2 >= or1


def _select_sheets(sheets: list[Sheet], sheet_name: str | None, *, allow_all: bool) -> list[Sheet]:
    if sheet_name is None:
        if allow_all:
            return sheets
        if not sheets:
            raise MaterialError(422, "The workbook has no sheets.")
        return sheets[:1]
    matches = [sheet for sheet in sheets if sheet[0] == sheet_name]
    if not matches:
        raise MaterialError(422, f"Sheet was not found: {sheet_name}.")
    return matches


def _xlsx_sheets(path: Path, warnings: list[str]) -> list[Sheet]:
    with _open_office(path, presentation_forbidden=True) as package:
        names = set(package.namelist())
        if "xl/workbook.xml" not in names:
            raise MaterialError(422, "The XLSX has no workbook.")
        workbook = _xml(_read_zip(package, "xl/workbook.xml"))
        rels = _xml(_read_zip(package, "xl/_rels/workbook.xml.rels"))
        targets = {
            node.attrib.get("Id", ""): node.attrib.get("Target", "")
            for node in rels.findall(_PKG + "Relationship")
        }
        shared: list[str] = []
        if "xl/sharedStrings.xml" in names:
            shared = _shared_strings(_xml(_read_zip(package, "xl/sharedStrings.xml")))
        sheets: list[Sheet] = []
        for node in workbook.findall(_S + "sheets/" + _S + "sheet"):
            name = (node.attrib.get("name") or "Sheet")[:200]
            relation = node.attrib.get(_REL + "id", "")
            target = _safe_target("xl", targets.get(relation, ""))
            if target not in names:
                raise MaterialError(422, f"Worksheet is missing: {name}.")
            cells, merges = _worksheet(_xml(_read_zip(package, target)), shared, warnings)
            sheets.append((name, target, cells, merges))
    return sheets


def _safe_target(base: str, target: str) -> str:
    cleaned = target.split("?", 1)[0].replace(chr(92), "/").lstrip("/")
    if cleaned.startswith("xl/"):
        resolved = posixpath.normpath(cleaned)
    else:
        resolved = posixpath.normpath(posixpath.join(base, cleaned))
    if resolved.startswith("../") or resolved.startswith("/"):
        raise MaterialError(422, "The workbook points outside the package.")
    return resolved


def _shared_strings(root: ET.Element) -> list[str]:
    return [
        "".join(node.text or "" for node in item.iter(_S + "t")) for item in root.findall(_S + "si")
    ]


def _worksheet(
    root: ET.Element, shared: list[str], warnings: list[str]
) -> tuple[dict[tuple[int, int], Cell], list[str]]:
    cells: dict[tuple[int, int], Cell] = {}
    for cell in root.iter(_S + "c"):
        parsed = _parse_cell(cell.attrib.get("r", ""))
        if parsed is None:
            continue
        column, row = parsed
        cells[(row, column)] = _xlsx_value(cell, shared, warnings)
    merges: list[str] = []
    for node in root.iter(_S + "mergeCell"):
        ref = node.attrib.get("ref", "")
        left, _, right = ref.partition(":")
        if _parse_cell(left) and _parse_cell(right):
            merges.append(ref)
        elif ref:
            _warn(warnings, "Skipped a merge outside A1 notation.")
    return cells, merges


def _xlsx_value(cell: ET.Element, shared: list[str], warnings: list[str]) -> Cell:
    kind = cell.attrib.get("t", "n")
    formula_node = cell.find(_S + "f")
    formula = formula_node.text if formula_node is not None and formula_node.text else None
    has_formula = formula_node is not None
    if kind == "inlineStr":
        inline = cell.find(_S + "is")
        text = "" if inline is None else "".join(node.text or "" for node in inline.iter(_S + "t"))
        value: Any = text
    else:
        raw = cell.findtext(_S + "v")
        value = _cached_scalar(kind, raw, shared, warnings)
    cached = has_formula and value is not None
    return value, formula, cached


def _cached_scalar(kind: str, raw: str | None, shared: list[str], warnings: list[str]) -> Any:
    if kind == "s":
        try:
            return shared[int(raw or "")]
        except (TypeError, ValueError, IndexError):
            _warn(warnings, "A shared string reference is missing.")
            return None
    if kind == "b":
        if raw == "1":
            return True
        if raw == "0":
            return False
        _warn(warnings, "A boolean cell had no cached value.")
        return None
    if kind == "e" or raw is None:
        return None
    return _number(raw, warnings)


def _number(raw: str, warnings: list[str]) -> Any:
    text = raw.strip()
    if re.fullmatch(r"-?[0-9]+", text):
        digits = text[1:] if text.startswith("-") else text
        if int(digits or "0") > MAX_SAFE_INTEGER:
            return text
        return int(text)
    try:
        value = float(text)
    except ValueError:
        return text
    if not math.isfinite(value):
        _warn(warnings, "A numeric cell was not a finite number.")
        return None
    if abs(value) > MAX_SAFE_INTEGER:
        return text
    return value


def _warn(warnings: list[str], message: str) -> None:
    if len(warnings) < 20:
        warnings.append(message[:4000])


def _pdf_pages(path: Path, _warnings: list[str]) -> tuple[list[str], bool]:
    text_tool = shutil.which("pdftotext")
    info_tool = shutil.which("pdfinfo")
    if text_tool is None:
        raise MaterialError(422, "pdftotext is not available.")
    with tempfile.TemporaryDirectory(prefix="material-pdf-") as directory:
        folder = Path(directory)
        text_path = folder / "text.txt"
        error_path = folder / "error.txt"
        _run_pdf([text_tool, "-enc", "UTF-8", "-layout", str(path), str(text_path)], error_path)
        data, cut = _read_bounded(text_path, MAX_PDF_TEXT_BYTES)
        if cut:
            raise MaterialError(422, "PDF text is larger than the read limit.")
        page_count = _pdf_page_count(info_tool, path, folder) if info_tool else None
    text = data.decode("utf-8", errors="replace")
    pages = text.split(chr(12))
    if pages and pages[-1] == "":
        pages.pop()
    if page_count is not None and page_count > len(pages):
        pages.extend([""] * (page_count - len(pages)))
    has_text = any(page.strip() for page in pages)
    if not has_text and (page_count or 0) > 0:
        return pages, True
    if not has_text:
        return [], True
    return pages, False


def _pdf_page_count(info_tool: str, path: Path, directory: Path) -> int | None:
    output = directory / "info.txt"
    errors = directory / "info-error.txt"
    try:
        _run_pdf([info_tool, str(path)], errors, stdout=output)
    except MaterialError:
        return None
    data, _cut = _read_bounded(output, 65_536)
    prefix = "pages:"
    for line in data.decode("utf-8", errors="replace").splitlines():
        if line.lower().startswith(prefix):
            try:
                return int(line.split(":", 1)[1].strip())
            except ValueError:
                return None
    return None


def _run_pdf(args: list[str], error_path: Path, stdout: Path | None = None) -> None:
    try:
        with error_path.open("wb") as error_handle:
            if stdout is None:
                completed = subprocess.run(
                    args,
                    check=False,
                    timeout=PDF_TIMEOUT_SECONDS,
                    stdout=subprocess.DEVNULL,
                    stderr=error_handle,
                )
            else:
                with stdout.open("wb") as out_handle:
                    completed = subprocess.run(
                        args,
                        check=False,
                        timeout=PDF_TIMEOUT_SECONDS,
                        stdout=out_handle,
                        stderr=error_handle,
                    )
    except subprocess.TimeoutExpired as error:
        raise MaterialError(422, "PDF tool timed out.") from error
    except OSError as error:
        raise MaterialError(422, "PDF tool could not be started.") from error
    if completed.returncode != 0:
        detail = _read_bounded(error_path, 400)[0].decode("utf-8", errors="replace").strip()
        raise MaterialError(422, detail or "PDF could not be read.")


def _read_bounded(path: Path, limit: int) -> tuple[bytes, bool]:
    if not path.is_file():
        return b"", False
    with path.open("rb") as handle:
        data = handle.read(limit + 1)
    if len(data) > limit:
        return data[:limit], True
    return data, False


def _open_office(path: Path, *, presentation_forbidden: bool) -> zipfile.ZipFile:
    try:
        package = zipfile.ZipFile(path)
    except zipfile.BadZipFile as error:
        raise MaterialError(422, "The file is not a valid package.") from error
    try:
        infos = package.infolist()
        if len(infos) > MAX_ZIP_ENTRIES:
            raise MaterialError(422, "The package has too many entries.")
        total = 0
        for info in infos:
            if info.file_size > MAX_ENTRY_BYTES:
                raise MaterialError(422, "A package entry is larger than 8 MB.")
            total += info.file_size
            if total > MAX_UNCOMPRESSED_BYTES:
                raise MaterialError(422, "The package expands past 64 MB.")
        names = package.namelist()
        if presentation_forbidden and any(name.startswith("ppt/") for name in names):
            raise MaterialError(422, "PPTX is not a supported material.")
    except Exception:
        package.close()
        raise
    return package


def _read_zip(package: zipfile.ZipFile, name: str) -> bytes:
    try:
        info = package.getinfo(name)
    except KeyError as error:
        raise MaterialError(422, f"Package entry is missing: {name}.") from error
    if info.file_size > MAX_ENTRY_BYTES:
        raise MaterialError(422, "A package entry is larger than 8 MB.")
    with package.open(info) as handle:
        data = handle.read(MAX_ENTRY_BYTES + 1)
    if len(data) > MAX_ENTRY_BYTES:
        raise MaterialError(422, "A package entry is larger than 8 MB.")
    return data


def _xml(data: bytes) -> ET.Element:
    text = _xml_text(data)
    lowered = text.lower()
    if "<!doctype" in lowered or "<!entity" in lowered:
        raise MaterialError(422, "XML DTD and entities are not accepted.")
    try:
        return ET.fromstring(text.encode("utf-8"))
    except ET.ParseError as error:
        raise MaterialError(422, "XML cannot be read.") from error


def _xml_text(data: bytes) -> str:
    if data.startswith(bytes((255, 254))) or data.startswith(bytes((254, 255))):
        encoding = "utf-16"
    elif data.startswith(bytes((239, 187, 191))):
        data = data[3:]
        encoding = "utf-8"
    else:
        encoding = "utf-8"
    try:
        return data.decode(encoding)
    except UnicodeError as error:
        raise MaterialError(422, "XML must be UTF-8 or UTF-16.") from error
