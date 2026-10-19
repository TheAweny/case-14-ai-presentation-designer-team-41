"""Tabular JSON: a list of records, a list of lists, columns with rows, or columns of values."""

import json
import math
from typing import Any

from engine.dataset._build import Raw
from engine.dataset.models import CellKind, Diagnostic, Severity


def _cell(value: Any, nested: list[int]) -> Raw:
    if value is None:
        return Raw("null", None, CellKind.empty)
    if isinstance(value, bool):
        return Raw(json.dumps(value), value, CellKind.boolean)
    if isinstance(value, (int, float)):
        if not math.isfinite(float(value)):
            raise ValueError("JSON numbers must be finite")
        return Raw(json.dumps(value), float(value), CellKind.number)
    if isinstance(value, str):
        return Raw(value)
    nested[0] += 1
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return Raw(text, text, CellKind.text)


def _grid(
    header: list[str], rows: list[list[Any]], sheet: str, diagnostics: list[Diagnostic]
) -> dict[int, dict[int, Raw]]:
    nested = [0]
    grid: dict[int, dict[int, Raw]] = {
        1: {column: Raw(name) for column, name in enumerate(header, start=1)}
    }
    for number, row in enumerate(rows, start=2):
        grid[number] = {column: _cell(value, nested) for column, value in enumerate(row, start=1)}
    if nested[0]:
        diagnostics.append(
            Diagnostic(
                code="nested-value",
                severity=Severity.warning,
                message=f"{nested[0]} value(s) are objects or lists; they are kept as JSON text.",
                sheet=sheet,
            )
        )
    return grid


def _from_records(records: list[dict[str, Any]]) -> tuple[list[str], list[list[Any]]]:
    header: list[str] = []
    for record in records:
        for key in record:
            if key not in header:
                header.append(key)
    return header, [[record.get(key, None) for key in header] for record in records]


def read_json(
    data: Any, sheet: str, diagnostics: list[Diagnostic]
) -> list[tuple[str, dict[int, dict[int, Raw]]]]:
    """The tables a JSON document holds, each under its name. None is guessed from other shapes."""
    if isinstance(data, list) and data and all(isinstance(item, dict) for item in data):
        header, rows = _from_records(data)
        return [(sheet, _grid(header, rows, sheet, diagnostics))]
    if isinstance(data, list) and data and all(isinstance(item, list) for item in data):
        width = max(len(item) for item in data)
        first, *rest = data
        if all(isinstance(cell, str) for cell in first):
            names = [str(cell) for cell in first] + [""] * (width - len(first))
            return [(sheet, _grid(names, rest, sheet, diagnostics))]
        return [(sheet, _grid([""] * width, data, sheet, diagnostics))]
    if isinstance(data, dict):
        columns, rows = data.get("columns"), data.get("rows")
        if isinstance(columns, list) and isinstance(rows, list):
            if not all(isinstance(column, (str, dict)) for column in columns):
                raise ValueError("JSON columns must be names or column objects")
            if not all(isinstance(row, (list, dict)) for row in rows):
                raise ValueError("JSON rows must be arrays or records")
            names = [c if isinstance(c, str) else str(c.get("name", "")) for c in columns]
            body = [r if isinstance(r, list) else [r.get(n) for n in names] for r in rows]
            return [(sheet, _grid(names, body, sheet, diagnostics))]
        if data and all(isinstance(v, list) for v in data.values()):
            sizes = {len(v) for v in data.values()}
            if len(sizes) == 1:
                names = list(data)
                length = sizes.pop()
                return [
                    (
                        sheet,
                        _grid(
                            names,
                            [[data[n][i] for n in names] for i in range(length)],
                            sheet,
                            diagnostics,
                        ),
                    )
                ]
            tables = []
            for name, value in data.items():
                if value and all(isinstance(item, dict) for item in value):
                    header, body = _from_records(value)
                    tables.append((str(name), _grid(header, body, str(name), diagnostics)))
            if tables:
                return tables
        if data and all(not isinstance(v, (dict, list)) for v in data.values()):
            diagnostics.append(
                Diagnostic(
                    code="key-value-table",
                    severity=Severity.info,
                    message="The object is one record; it is read as a table of keys and values.",
                    sheet=sheet,
                )
            )
            return [
                (
                    sheet,
                    _grid(["key", "value"], [[k, v] for k, v in data.items()], sheet, diagnostics),
                )
            ]
    diagnostics.append(
        Diagnostic(
            code="no-table",
            severity=Severity.error,
            message="The JSON holds no table: expected a list of records, a list of rows, "
            "columns with rows, or named lists of values.",
        )
    )
    return []
