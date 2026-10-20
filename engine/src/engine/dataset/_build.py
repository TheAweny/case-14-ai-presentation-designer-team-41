"""From the cells a reader found to a typed sheet: nothing left out, no value made up."""

import re
from collections import Counter
from dataclasses import dataclass

from engine.dataset._numbers import parse_date, parse_number
from engine.dataset.models import (
    Cell,
    CellKind,
    Column,
    Diagnostic,
    Row,
    Severity,
    Sheet,
    SheetState,
)


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


#: How people write «no value» in a cell. Such a cell is a gap, never a zero; its text is kept.
MISSING_MARKERS = frozenset(
    {"-", "—", "–", "−", "н/д", "н.д.", "нд", "нет данных", "n/a", "na", "#n/a", "null", "nan"}
)
#: A row that sums the rows above it: a chart or a total over the column must not count it twice.
_TOTAL = re.compile(r"^(итого|всего|итог|total|grand total)\b", re.IGNORECASE)
#: Rows above a table that may be its title: a report name, a period, a blank line.
_PREAMBLE_LIMIT = 5


def _typed(raw: Raw, ref: str, sheet: str, hint: str, diagnostics: list[Diagnostic]) -> Cell:
    if raw.kind is not None:
        return Cell(ref=ref, raw=raw.text, kind=raw.kind, value=raw.value, unit=raw.unit)
    text = raw.text
    if text is None or not text.strip() or text.strip().lower() in MISSING_MARKERS:
        return Cell(ref=ref, raw=text, kind=CellKind.empty)
    number = parse_number(text, hint)
    if number.value is not None:
        return Cell(ref=ref, raw=text, kind=CellKind.number, value=number.value, unit=number.unit)
    if number.ambiguous:
        diagnostics.append(
            Diagnostic(
                code="ambiguous-number",
                severity=Severity.warning,
                message=f"«{text.strip()}» reads as {number.candidates[0]:g} or "
                f"{number.candidates[1]:g}; no value was chosen.",
                sheet=sheet,
                ref=ref,
            )
        )
        return Cell(
            ref=ref,
            raw=text,
            kind=CellKind.text,
            value=text.strip(),
            candidates=list(number.candidates),
        )
    date = parse_date(text)
    if date is not None and date.iso:
        return Cell(ref=ref, raw=text, kind=CellKind.date, value=date.iso)
    if date is not None and date.ambiguous:
        diagnostics.append(
            Diagnostic(
                code="ambiguous-date",
                severity=Severity.warning,
                message=f"«{text.strip()}» is {date.candidates[0]} or {date.candidates[1]}; "
                "no date was chosen.",
                sheet=sheet,
                ref=ref,
            )
        )
        return Cell(
            ref=ref,
            raw=text,
            kind=CellKind.text,
            value=text.strip(),
            candidates=list(date.candidates),
        )
    return Cell(ref=ref, raw=text, kind=CellKind.text, value=text.strip())


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
                severity=Severity.warning,
                message="The sheet holds no data.",
                sheet=name,
            )
        )
        return Sheet(
            sheetId=sheet_id,
            name=name,
            index=index,
            state=SheetState.hidden if state in ("hidden", "veryHidden") else SheetState.visible,
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
                    severity=Severity.warning,
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

    markers = Counter(
        (cell.raw or "").strip()
        for row in rows
        for cell, raw in zip(typed[row], (grid.get(row, {}).get(c) for c in columns), strict=True)
        if raw is not None
        and raw.kind is None
        and cell.kind == "empty"
        and (cell.raw or "").strip()
    )
    if markers:
        written = ", ".join(f"«{marker}»" for marker in sorted(markers))
        diagnostics.append(
            Diagnostic(
                code="missing-markers",
                severity=Severity.info,
                message=f"{sum(markers.values())} cell(s) say there is no value ({written}); "
                "they are gaps, not zeros.",
                sheet=name,
            )
        )

    preamble = _preamble(typed, rows, len(columns))
    if preamble:
        titles = " / ".join(
            " ".join(cell.raw.strip() for cell in typed[row] if cell.raw and cell.raw.strip())
            for row in preamble
            if any(cell.raw and cell.raw.strip() for cell in typed[row])
        )
        diagnostics.append(
            Diagnostic(
                code="preamble-rows",
                severity=Severity.info,
                message=f"{len(preamble)} row(s) above the table are its title, not its data: "
                f"«{titles}».",
                sheet=name,
                ref=f"{preamble[0]}:{preamble[-1]}",
            )
        )
    body = [row for row in rows if row not in preamble]
    header_row = _header_row(typed, body)
    data_rows = [row for row in body if row != header_row]
    total = _total_row(typed, data_rows)
    if total is not None:
        diagnostics.append(
            Diagnostic(
                code="total-row",
                severity=Severity.info,
                message="The last row sums the rows above it; a total over the column counts it "
                "once, not twice.",
                sheet=name,
                ref=total,
            )
        )
    headers = (
        [cell.raw.strip() if cell.raw and cell.raw.strip() else None for cell in typed[header_row]]
        if header_row is not None
        else [None] * len(columns)
    )
    if header_row is None:
        diagnostics.append(
            Diagnostic(
                code="no-header",
                severity=Severity.info,
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
                    severity=Severity.warning,
                    message=f"The header «{header}» names {count} columns.",
                    sheet=name,
                )
            )

    column_models: list[Column] = []
    for offset, column in enumerate(columns):
        kinds: Counter[CellKind] = Counter(
            typed[row][offset].kind for row in data_rows if typed[row][offset].kind != "empty"
        )
        kind: CellKind = kinds.most_common(1)[0][0] if kinds else CellKind.empty
        if len(kinds) > 1 and kind in ("number", "date"):
            stray = sum(count for found, count in kinds.items() if found != kind)
            diagnostics.append(
                Diagnostic(
                    code="mixed-column",
                    severity=Severity.warning,
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
        state=SheetState.hidden if state in ("hidden", "veryHidden") else SheetState.visible,
        range=f"{cell_ref(first_row, first_column)}:{cell_ref(last_row, last_column)}",
        headerRow=header_row,
        columns=column_models,
        rows=[Row(row=row, cells=typed[row]) for row in data_rows],
        mergedRanges=merged or [],
    )


def _filled(cells: list[Cell]) -> int:
    return sum(1 for cell in cells if cell.kind != "empty" or (cell.raw or "").strip())


def _preamble(typed: dict[int, list[Cell]], rows: range, width: int) -> list[int]:
    """Rows above the table that fill too few columns to belong to it: a title, a period, a gap.

    They count only when a row wide enough to be the table follows within the first few lines;
    otherwise every row is the table's own, however sparse.
    """
    if width < 2:
        return []
    wide = max(2, (width + 1) // 2)
    seen: list[int] = []
    for row in rows:
        if _filled(typed[row]) >= wide:
            return seen if any(_filled(typed[r]) for r in seen) else []
        seen.append(row)
        if sum(1 for r in seen if _filled(typed[r])) > _PREAMBLE_LIMIT:
            return []
    return []


def _total_row(typed: dict[int, list[Cell]], data_rows: list[int]) -> str | None:
    """The reference of the label of a last row that says it totals the rows above."""
    filled = [row for row in data_rows if _filled(typed[row])]
    if len(filled) < 3:
        return None
    last = filled[-1]
    label = next((cell for cell in typed[last] if cell.kind == "text"), None)
    if label is not None and label.raw and _TOTAL.match(label.raw.strip()):
        return label.ref
    return None


def _header_row(typed: dict[int, list[Cell]], rows: range | list[int]) -> int | None:
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
