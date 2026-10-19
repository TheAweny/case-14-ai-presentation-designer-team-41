"""From the cells a reader found to a typed sheet: nothing left out, no value made up."""

from collections import Counter
from dataclasses import dataclass

from engine.dataset._numbers import parse_date, parse_number
from engine.dataset.models import Cell, CellKind, Column, Diagnostic, Row, Sheet


@dataclass(frozen=True, slots=True)
class Raw:
    """A cell as a reader found it: the text, and its type when the file itself states one."""

    text: str | None
    #: Set when the format types its cells (a spreadsheet's numbers and dates, JSON's booleans).
    value: float | str | bool | None = None
    kind: CellKind | None = None
    unit: str = ""


def column_letters(index: int) -> str:
    """A, B, ..., Z, AA: the spreadsheet name of a column, from index 1."""
    name = ""
    while index > 0:
        index, remainder = divmod(index - 1, 26)
        name = chr(ord("A") + remainder) + name
    return name


def cell_ref(row: int, column: int) -> str:
    return f"{column_letters(column)}{row}"


def _decimal_evidence(cells: list[Raw]) -> str:
    """The decimal separator a set of cells shows: one of them when the cells agree."""
    seen = Counter(
        number.decimal
        for cell in cells
        if cell.value is None and cell.text
        for number in [parse_number(cell.text)]
        if number.decimal
    )
    return seen.most_common(1)[0][0] if len(seen) == 1 else ""


def _typed(raw: Raw, ref: str, sheet: str, hint: str, diagnostics: list[Diagnostic]) -> Cell:
    if raw.kind is not None:
        return Cell(ref=ref, raw=raw.text, kind=raw.kind, value=raw.value, unit=raw.unit)
    text = raw.text
    if text is None or not text.strip():
        return Cell(ref=ref, raw=text, kind="empty")
    number = parse_number(text, hint)
    if number.value is not None:
        return Cell(ref=ref, raw=text, kind="number", value=number.value, unit=number.unit)
    if number.ambiguous:
        diagnostics.append(
            Diagnostic(
                code="ambiguous-number",
                severity="warning",
                message=f"«{text.strip()}» reads as {number.candidates[0]:g} or "
                f"{number.candidates[1]:g}; no value was chosen.",
                sheet=sheet,
                ref=ref,
            )
        )
        return Cell(
            ref=ref, raw=text, kind="text", value=text.strip(), candidates=list(number.candidates)
        )
    date = parse_date(text)
    if date is not None and date.iso:
        return Cell(ref=ref, raw=text, kind="date", value=date.iso)
    if date is not None and date.ambiguous:
        diagnostics.append(
            Diagnostic(
                code="ambiguous-date",
                severity="warning",
                message=f"«{text.strip()}» is {date.candidates[0]} or {date.candidates[1]}; "
                "no date was chosen.",
                sheet=sheet,
                ref=ref,
            )
        )
        return Cell(
            ref=ref, raw=text, kind="text", value=text.strip(), candidates=list(date.candidates)
        )
    return Cell(ref=ref, raw=text, kind="text", value=text.strip())


def build_sheet(
    index: int,
    name: str,
    grid: dict[int, dict[int, Raw]],
    diagnostics: list[Diagnostic],
    *,
    state: str = "visible",
    merged: list[str] | None = None,
) -> Sheet:
    """A typed sheet from the cells at `grid[row][column]`, rows and columns counted from 1."""
    sheet_id = f"sheet-{index + 1}"
    filled = {
        (row, column): raw
        for row, cells in grid.items()
        for column, raw in cells.items()
        if (raw.text is not None and raw.text.strip()) or raw.kind not in (None, "empty")
    }
    if not filled:
        diagnostics.append(
            Diagnostic(
                code="empty-sheet",
                severity="warning",
                message="The sheet holds no data.",
                sheet=name,
            )
        )
        return Sheet(
            sheetId=sheet_id,
            name=name,
            index=index,
            state="hidden" if state == "hidden" else "visible",
            range="",
            headerRow=None,
            columns=[],
            rows=[],
            mergedRanges=merged or [],
        )
    first_row = min(row for row, _ in filled)
    last_row = max(row for row, _ in filled)
    last_column = max(column for _, column in filled)
    first_column = min(column for _, column in filled)
    columns = range(first_column, last_column + 1)
    rows = range(first_row, last_row + 1)

    # The decimal separator each column shows, else the one the whole sheet shows.
    per_column = {
        column: _decimal_evidence([grid.get(row, {}).get(column, Raw(None)) for row in rows])
        for column in columns
    }
    sheet_hint = Counter(hint for hint in per_column.values() if hint)
    everywhere = sheet_hint.most_common(1)[0][0] if len(sheet_hint) == 1 else ""
    for column, hint in per_column.items():
        # Both separators as decimal ones in one column: the column has no locale to lend.
        mixed = Counter(
            number.decimal
            for row in rows
            for raw in [grid.get(row, {}).get(column)]
            if raw is not None and raw.value is None and raw.text
            for number in [parse_number(raw.text)]
            if number.decimal
        )
        if len(mixed) > 1:
            per_column[column] = ""
            diagnostics.append(
                Diagnostic(
                    code="mixed-decimal-separators",
                    severity="warning",
                    message="The column writes decimals with both a point and a comma.",
                    sheet=name,
                    ref=column_letters(column),
                )
            )
        elif not hint:
            per_column[column] = everywhere

    typed: dict[int, list[Cell]] = {}
    for row in rows:
        typed[row] = [
            _typed(
                grid.get(row, {}).get(column, Raw(None)),
                cell_ref(row, column),
                name,
                per_column[column],
                diagnostics,
            )
            for column in columns
        ]

    header_row = _header_row(typed, rows)
    data_rows = [row for row in rows if row != header_row]
    headers = (
        [cell.raw.strip() if cell.raw and cell.raw.strip() else None for cell in typed[header_row]]
        if header_row is not None
        else [None] * len(columns)
    )
    if header_row is None:
        diagnostics.append(
            Diagnostic(
                code="no-header",
                severity="info",
                message="No header row was found; the columns are named by their letters.",
                sheet=name,
            )
        )
    seen_headers = Counter(header for header in headers if header)
    for header, count in seen_headers.items():
        if count > 1:
            diagnostics.append(
                Diagnostic(
                    code="duplicate-header",
                    severity="warning",
                    message=f"The header «{header}» names {count} columns.",
                    sheet=name,
                )
            )

    column_models: list[Column] = []
    for offset, column in enumerate(columns):
        kinds: Counter[CellKind] = Counter(
            typed[row][offset].kind for row in data_rows if typed[row][offset].kind != "empty"
        )
        kind: CellKind = kinds.most_common(1)[0][0] if kinds else "empty"
        if len(kinds) > 1 and kind in ("number", "date"):
            stray = sum(count for found, count in kinds.items() if found != kind)
            diagnostics.append(
                Diagnostic(
                    code="mixed-column",
                    severity="warning",
                    message=f"{stray} cell(s) of the column are not {kind}s: they keep their text "
                    "and no value.",
                    sheet=name,
                    ref=column_letters(column),
                )
            )
        column_models.append(
            Column(
                columnId=f"{sheet_id}:{column_letters(column)}",
                index=column,
                ref=column_letters(column),
                header=headers[offset],
                kind=kind,
                decimal=per_column[column],
            )
        )

    return Sheet(
        sheetId=sheet_id,
        name=name,
        index=index,
        state="hidden" if state == "hidden" else "visible",
        range=f"{cell_ref(first_row, first_column)}:{cell_ref(last_row, last_column)}",
        headerRow=header_row,
        columns=column_models,
        rows=[Row(row=row, cells=typed[row]) for row in data_rows],
        mergedRanges=merged or [],
    )


def _header_row(typed: dict[int, list[Cell]], rows: range) -> int | None:
    """The first non-empty row when it is a row of names: text only, over rows that hold data."""
    first = next((row for row in rows if any(c.kind != "empty" for c in typed[row])), None)
    if first is None:
        return None
    cells = [cell for cell in typed[first] if cell.kind != "empty"]
    if any(cell.kind != "text" for cell in cells):
        return None
    later = [row for row in rows if row > first and any(c.kind != "empty" for c in typed[row])]
    if not later:
        return None
    holds_values = any(cell.kind in ("number", "date") for row in later for cell in typed[row])
    names = [cell.raw.strip() for cell in cells if cell.raw]
    return first if holds_values or len(set(names)) == len(names) else None


__all__ = ["Raw", "build_sheet", "cell_ref", "column_letters"]
