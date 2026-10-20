"""Tables of data, read from the files people bring: CSV, TSV, XLSX, JSON and text tables.

Nothing here calls a model, and nothing here decides what a table means: it keeps every value as
the file held it, with its place, and derives a typed value only where the text allows one reading.
A file that cannot be read gives a diagnostic, not an empty dataset that looks like an answer, and
a file too large is refused whole rather than read from its first rows.
"""

import hashlib
import json
from pathlib import Path
from typing import Any

from engine.dataset import _delimited, _json, _markdown, _xlsx
from engine.dataset._build import Raw, build_sheet
from engine.dataset.models import Dataset, DatasetStatus, Diagnostic, Severity, Sheet, Source

#: The biggest file read at all. Above it the file is refused, never cut.
MAX_BYTES = 50 * 1024 * 1024

_MEDIA_TYPES = {
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
}


def _failed(source: Source, diagnostics: list[Diagnostic]) -> Dataset:
    return Dataset(
        datasetId=f"dataset-{source.sha256[:16]}",
        status=DatasetStatus.failed,
        source=source,
        sheets=[],
        diagnostics=diagnostics,
    )


def _kind_of(data: bytes, suffix: str) -> str:
    """The reader a file goes to: by its name, and by its first bytes when the name says nothing."""
    if suffix in (".xlsx", ".xlsm"):
        return "xlsx"
    if suffix == ".xls":
        return "xls"
    if suffix == ".json":
        return "json"
    if suffix in (".md", ".markdown"):
        return "markdown"
    if suffix in (".csv", ".tsv"):
        return "delimited"
    if data[:2] == b"PK":
        return "xlsx"
    if data.lstrip()[:1] in (b"{", b"["):
        return "json"
    return "text"


def extract_dataset(path: Path) -> Dataset:
    """Read the tables of a file. Never raises for a bad file: the dataset says what went wrong."""
    data = path.read_bytes() if path.stat().st_size <= MAX_BYTES else b""
    size = path.stat().st_size
    suffix = path.suffix.lower()
    source = Source(
        fileName=path.name,
        mediaType=_MEDIA_TYPES.get(suffix, "application/octet-stream"),
        bytes=size,
        # A file too large is not read, so its digest names it; an empty file has a real one.
        sha256=hashlib.sha256(data if size <= MAX_BYTES else path.name.encode()).hexdigest(),
    )
    diagnostics: list[Diagnostic] = []
    if size > MAX_BYTES:
        diagnostics.append(
            Diagnostic(
                code="too-large",
                severity=Severity.error,
                message=f"The file is {size} bytes; more than {MAX_BYTES} is not read, "
                "and a part of it is never taken for the whole.",
            )
        )
        return _failed(source, diagnostics)
    if not data:
        diagnostics.append(
            Diagnostic(code="empty-file", severity=Severity.error, message="The file is empty.")
        )
        return _failed(source, diagnostics)

    sheets: list[Sheet] = []
    grids: list[tuple[str, str, dict[int, dict[int, Raw]], list[str]]] = []
    kind = _kind_of(data, suffix)
    try:
        if kind == "xls":
            diagnostics.append(
                Diagnostic(
                    code="unsupported-format",
                    severity=Severity.error,
                    message="The old .xls format is not read; save the workbook as .xlsx.",
                )
            )
        elif kind == "xlsx":
            grids = _xlsx.read_workbook(data, diagnostics)
        elif kind == "json":
            grids = _json_grids(data, path.stem, diagnostics)
        else:
            text = _delimited.decode(data, diagnostics)
            if text is not None:
                tables = _text_tables(text, diagnostics) if kind in ("markdown", "text") else []
                if tables:
                    grids = [
                        (f"Table {number}", "visible", grid, [])
                        for number, grid in enumerate(tables, 1)
                    ]
                elif kind == "markdown" or (
                    kind == "text" and not _delimited.is_table(text, suffix)
                ):
                    diagnostics.append(
                        Diagnostic(
                            code="no-table",
                            severity=Severity.error,
                            message="The text holds no table: no pipe table with a separator "
                            "row, no block pasted from a spreadsheet, and its lines do not "
                            "split into the same columns.",
                        )
                    )
                else:
                    grids = [
                        (
                            path.stem,
                            "visible",
                            _delimited.read_delimited(text, suffix, diagnostics, path.stem),
                            [],
                        )
                    ]
        for index, (name, state, grid, merged) in enumerate(grids):
            sheets.append(build_sheet(index, name, grid, diagnostics, state=state, merged=merged))
        # Numeric overflow and non-finite source values must not escape as an invalid JSON response.
        for sheet in sheets:
            sheet.model_dump_json()
    except (_xlsx.WorkbookError, ValueError, OverflowError) as error:
        diagnostics.append(
            Diagnostic(code="unreadable", severity=Severity.error, message=str(error))
        )
        sheets = []
    if not any(sheet.rows or sheet.columns for sheet in sheets) and not any(
        d.severity == "error" for d in diagnostics
    ):
        diagnostics.append(
            Diagnostic(code="no-data", severity=Severity.error, message="The file holds no data.")
        )
    errors = any(d.severity == "error" for d in diagnostics)
    warnings = any(d.severity == "warning" for d in diagnostics)
    return Dataset(
        datasetId=f"dataset-{source.sha256[:16]}",
        status=DatasetStatus.failed
        if errors
        else DatasetStatus.partial
        if warnings
        else DatasetStatus.ok,
        source=source,
        sheets=[] if errors and not sheets else sheets,
        diagnostics=diagnostics,
    )


def _text_tables(text: str, diagnostics: list[Diagnostic]) -> list[dict[int, dict[int, Raw]]]:
    """The tables written into a text, in the order they come: pipe tables and pasted blocks."""
    pieces: list[tuple[int, dict[int, dict[int, Raw]] | str]] = []
    unwrapped = 0
    for start, grid, plain in _markdown.find_tables(text):
        pieces.append((start, grid))
        unwrapped += plain
    pieces += _delimited.tab_blocks(text)
    pieces.sort(key=lambda item: item[0])
    tables = [
        piece
        if isinstance(piece, dict)
        else _delimited.read_delimited(piece, ".tsv", diagnostics, f"Table {number}")
        for number, (_, piece) in enumerate(pieces, start=1)
    ]
    if unwrapped:
        diagnostics.append(
            Diagnostic(
                code="markup-removed",
                severity=Severity.info,
                message=f"{unwrapped} cell(s) were wrapped in Markdown bold, italics or code; "
                "the wrapping was taken off to read the value.",
            )
        )
    return tables


def _json_grids(
    data: bytes, stem: str, diagnostics: list[Diagnostic]
) -> list[tuple[str, str, dict[int, dict[int, Raw]], list[str]]]:
    def refuse(constant: str) -> Any:
        raise ValueError(f"{constant} is not a JSON value")

    try:
        parsed = json.loads(data.decode("utf-8-sig"), parse_constant=refuse)
    except (UnicodeDecodeError, ValueError) as error:
        diagnostics.append(
            Diagnostic(
                code="unreadable",
                severity=Severity.error,
                message=f"The JSON is not valid: {error}",
            )
        )
        return []
    return [
        (name, "visible", grid, []) for name, grid in _json.read_json(parsed, stem, diagnostics)
    ]


__all__ = ["MAX_BYTES", "Dataset", "extract_dataset"]
