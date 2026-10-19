"""Tables written in text, with pipes: the Markdown tables of a pasted brief."""

import re

from engine.dataset._build import Raw

_SEPARATOR = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")


def _cells(line: str) -> list[str]:
    text = line.strip()
    if text.startswith("|"):
        text = text[1:]
    if text.endswith("|"):
        text = text[:-1]
    return [cell.strip() for cell in text.split("|")]


def read_tables(text: str) -> list[dict[int, dict[int, Raw]]]:
    """Every pipe table of the text: a row of names, a separator row and the rows under them."""
    tables: list[dict[int, dict[int, Raw]]] = []
    lines = text.splitlines()
    index = 0
    while index < len(lines) - 1:
        if "|" in lines[index] and _SEPARATOR.match(lines[index + 1]) and "|" in lines[index + 1]:
            rows = [_cells(lines[index])]
            index += 2
            while index < len(lines) and "|" in lines[index] and lines[index].strip():
                rows.append(_cells(lines[index]))
                index += 1
            tables.append(
                {
                    number: {column: Raw(cell) for column, cell in enumerate(row, start=1)}
                    for number, row in enumerate(rows, start=1)
                }
            )
        else:
            index += 1
    return tables
