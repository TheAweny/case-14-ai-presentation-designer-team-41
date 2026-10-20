"""Workbooks of the .xlsx kind, read with the standard library and no formula engine.

The values are the ones the file stored: a formula's last calculated result, not a recalculation.
A formula without a stored result is said so, never given a value. The file is opened as the
hostile input it may be: archives are bounded, and XML that declares entities is refused.
"""

import io
import re
import zipfile
from datetime import datetime, timedelta
from typing import Any
from xml.etree import ElementTree

from engine.dataset._build import Raw
from engine.dataset.models import CellKind, Diagnostic, Severity

_NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "p": "http://schemas.openxmlformats.org/package/2006/relationships",
}
_M = "{" + _NS["m"] + "}"
_R = "{" + _NS["r"] + "}"
#: What a workbook may unpack to, and the most one part may inflate by: bounds against bombs.
_MAX_UNPACKED = 300 * 1024 * 1024
_MAX_RATIO = 200
#: Cells a sheet may hold before it is refused whole, rather than read from its first rows.
MAX_CELLS = 2_000_000
_DATE_FORMATS = frozenset({*range(14, 23), *range(27, 37), *range(45, 48), *range(50, 59)})
_PERCENT_FORMATS = frozenset({9, 10})


class WorkbookError(Exception):
    """The file is not a workbook this reader can open."""


def _xml(archive: zipfile.ZipFile, name: str) -> ElementTree.Element:
    try:
        data = archive.read(name)
    except (KeyError, zipfile.BadZipFile, RuntimeError) as error:
        raise WorkbookError(f"The workbook part {name} cannot be read.") from error
    declarations = data.replace(b"\x00", b"")
    if b"<!DOCTYPE" in declarations or b"<!ENTITY" in declarations:
        raise WorkbookError(f"{name} declares entities, which a workbook never does.")
    try:
        return ElementTree.fromstring(data)
    except ElementTree.ParseError as error:
        raise WorkbookError(f"{name} is not valid XML: {error}") from error


def _text(element: ElementTree.Element | None) -> str:
    """The text of a string item: its plain text or the runs of a rich one."""
    if element is None:
        return ""
    return "".join(
        node.text or ""
        for child in element
        for node in ([child] if child.tag == _M + "t" else child.findall("m:t", _NS))
        if child.tag in (_M + "t", _M + "r")
    )


def _is_date_code(code: str) -> bool:
    plain = re.sub(r'"[^"]*"|\[[^\]]*\]|\\.', "", code)
    return bool(re.search(r"[ymd]", plain, re.IGNORECASE)) and not re.search(r"0|#", plain)


def _style_kinds(archive: zipfile.ZipFile) -> list[str]:
    """For each cell style, what a number in it is: a date, a percentage or just a number."""
    if "xl/styles.xml" not in archive.namelist():
        return []
    root = _xml(archive, "xl/styles.xml")
    custom = {
        int(node.get("numFmtId", "0")): node.get("formatCode", "")
        for node in root.iterfind("m:numFmts/m:numFmt", _NS)
    }
    kinds: list[str] = []
    for xf in root.iterfind("m:cellXfs/m:xf", _NS):
        identifier = int(xf.get("numFmtId", "0"))
        if identifier in _PERCENT_FORMATS or "%" in custom.get(identifier, ""):
            kinds.append("percent")
        elif identifier in _DATE_FORMATS or (
            identifier in custom and _is_date_code(custom[identifier])
        ):
            kinds.append("date")
        else:
            kinds.append("number")
    return kinds


def _serial_date(serial: float, base_1904: bool) -> str:
    start = datetime(1904, 1, 1) if base_1904 else datetime(1899, 12, 30)
    moment = start + timedelta(days=serial)
    return (
        moment.date().isoformat() if serial == int(serial) else moment.isoformat(timespec="seconds")
    )


def _column_index(ref: str) -> int:
    letters = re.match(r"[A-Z]+", ref)
    index = 0
    for char in letters.group(0) if letters else "A":
        index = index * 26 + ord(char) - 64
    return index


def read_workbook(
    data: bytes, diagnostics: list[Diagnostic]
) -> list[tuple[str, str, dict[int, dict[int, Raw]], list[str]]]:
    """Every sheet as (name, state, cells, merged ranges), hidden ones included and marked."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as error:
        raise WorkbookError("The file is not a zip archive, so not a workbook.") from error
    infos = archive.infolist()
    if sum(info.file_size for info in infos) > _MAX_UNPACKED or any(
        info.compress_size
        and info.file_size / info.compress_size > _MAX_RATIO
        and info.file_size > 50_000_000
        for info in infos
    ):
        raise WorkbookError("The archive unpacks to far more than a workbook can hold.")
    names = set(archive.namelist())
    if "xl/workbook.xml" not in names:
        raise WorkbookError("The archive holds no workbook (xl/workbook.xml is missing).")
    workbook = _xml(archive, "xl/workbook.xml")
    properties = workbook.find("m:workbookPr", _NS)
    base_1904 = properties is not None and properties.get("date1904") in ("1", "true")
    relations = {
        node.get("Id", ""): node.get("Target", "")
        for node in _xml(archive, "xl/_rels/workbook.xml.rels").iterfind("p:Relationship", _NS)
    }
    shared: list[str] = []
    if "xl/sharedStrings.xml" in names:
        shared = [
            _text(item) for item in _xml(archive, "xl/sharedStrings.xml").iterfind("m:si", _NS)
        ]
    kinds = _style_kinds(archive)

    sheets = []
    for node in workbook.iterfind("m:sheets/m:sheet", _NS):
        name = node.get("name", "")
        target = relations.get(node.get(_R + "id", ""), "")
        path = target.lstrip("/") if target.startswith("/") else f"xl/{target}"
        if path not in names:
            diagnostics.append(
                Diagnostic(
                    code="sheet-missing",
                    severity=Severity.error,
                    message=f"The sheet «{name}» is listed, but {path} is not in the file.",
                    sheet=name,
                )
            )
            continue
        sheets.append(
            (
                name,
                node.get("state", "visible"),
                *_read_sheet(archive, path, name, shared, kinds, base_1904, diagnostics),
            )
        )
    return sheets


def _read_sheet(
    archive: zipfile.ZipFile,
    path: str,
    sheet: str,
    shared: list[str],
    kinds: list[str],
    base_1904: bool,
    diagnostics: list[Diagnostic],
) -> tuple[dict[int, dict[int, Raw]], list[str]]:
    root = _xml(archive, path)
    grid: dict[int, dict[int, Raw]] = {}
    unstored = 0
    errors = 0
    cells = 0
    for row_node in root.iterfind("m:sheetData/m:row", _NS):
        for cell in row_node.iterfind("m:c", _NS):
            ref = cell.get("r", "")
            cells += 1
            if cells > MAX_CELLS:
                raise WorkbookError(
                    f"The sheet «{sheet}» holds over {MAX_CELLS} cells; it is not read in part."
                )
            row = int(re.sub(r"\D", "", ref) or row_node.get("r", "0"))
            column = _column_index(ref)
            kind = cell.get("t", "n")
            stored = cell.find("m:v", _NS)
            style = int(cell.get("s", "0"))
            has_formula = cell.find("m:f", _NS) is not None
            raw = _cell(
                cell,
                kind,
                stored,
                kinds[style] if style < len(kinds) else "number",
                shared,
                base_1904,
            )
            if raw is None:
                if has_formula:
                    unstored += 1
                continue
            if raw.kind == "text" and raw.value is None and (raw.text or "").startswith("#"):
                errors += 1
            grid.setdefault(row, {})[column] = raw
    if unstored:
        diagnostics.append(
            Diagnostic(
                code="formula-without-value",
                severity=Severity.warning,
                message=f"{unstored} formula cell(s) have no stored result; they are empty here. "
                "Open and save the workbook in a spreadsheet program to store the results.",
                sheet=sheet,
            )
        )
    if errors:
        diagnostics.append(
            Diagnostic(
                code="cell-error",
                severity=Severity.warning,
                message=f"{errors} cell(s) hold a spreadsheet error (#DIV/0!, #N/A): no value.",
                sheet=sheet,
            )
        )
    merged = [node.get("ref", "") for node in root.iterfind("m:mergeCells/m:mergeCell", _NS)]
    if merged:
        diagnostics.append(
            Diagnostic(
                code="merged-cells",
                severity=Severity.info,
                message=f"{len(merged)} merged range(s); the value sits in the first cell of each.",
                sheet=sheet,
            )
        )
    return grid, merged


def _cell(
    cell: ElementTree.Element,
    kind: str,
    stored: ElementTree.Element | None,
    style: str,
    shared: list[str],
    base_1904: bool,
) -> Raw | None:
    if kind == "inlineStr":
        return Raw(_text(cell.find("m:is", _NS)))
    if stored is None or stored.text is None:
        return None
    text = stored.text
    if kind == "s":
        index = int(text)
        return Raw(shared[index] if index < len(shared) else "")
    if kind == "str":
        return Raw(text)
    if kind == "b":
        return Raw("TRUE" if text == "1" else "FALSE", text == "1", CellKind.boolean)
    if kind == "e":
        return Raw(text, None, CellKind.text)
    try:
        number: Any = float(text)
    except ValueError:
        return Raw(text)
    if style == "date":
        return Raw(text, _serial_date(number, base_1904), CellKind.date)
    if style == "percent":
        return Raw(text, number * 100, CellKind.number, "%")
    return Raw(text, number, CellKind.number)


__all__ = ["MAX_CELLS", "WorkbookError", "read_workbook"]
