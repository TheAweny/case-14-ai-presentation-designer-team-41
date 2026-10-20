"""Tables written in text, with pipes: the Markdown tables of a pasted brief."""

import re

from engine.dataset._build import Raw

_SEPARATOR = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")
#: A cell wrapped whole in bold, italics or code: the wrapping is how it looks, not what it says.
_WRAPPED = re.compile(r"^(\*\*|__|\*|_|`)(.+)\1$")


def _split(line: str) -> list[str]:
    """The cells of a row. «\\|» is a pipe inside a cell, not a border between two."""
    cells, current, escaped = [], "", False
    for char in line:
        if escaped:
            current += char if char == "|" else "\\" + char
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == "|":
            cells.append(current)
            current = ""
        else:
            current += char
    cells.append(current + ("\\" if escaped else ""))
    return cells


def _cells(line: str) -> list[str]:
    text = line.strip()
    if text.startswith("|"):
        text = text[1:]
    if text.endswith("|") and not text.endswith("\\|"):
        text = text[:-1]
    return [cell.strip() for cell in _split(text)]


def _unwrap(cell: str) -> str:
    """«**1 219**» and «`1 202`» say 1 219 and 1 202; the stars and ticks are only the look."""
    while True:
        match = _WRAPPED.match(cell)
        if not match or not match.group(2).strip():
            return cell
        cell = match.group(2).strip()


def _is_row(line: str) -> bool:
    return bool(line.strip()) and "|" in line.replace("\\|", "")


def find_tables(text: str) -> list[tuple[int, dict[int, dict[int, Raw]], int]]:
    """Every pipe table of the text with the line it starts on and how many cells lost markup.

    A table is a row of names, a separator row and the rows under them.
    """
    tables: list[tuple[int, dict[int, dict[int, Raw]], int]] = []
    lines = text.splitlines()
    index = 0
    while index < len(lines) - 1:
        if _is_row(lines[index]) and _SEPARATOR.match(lines[index + 1]) and "|" in lines[index + 1]:
            start = index
            rows = [_cells(lines[index])]
            index += 2
            while index < len(lines) and _is_row(lines[index]):
                rows.append(_cells(lines[index]))
                index += 1
            unwrapped = 0
            grid: dict[int, dict[int, Raw]] = {}
            for number, row in enumerate(rows, start=1):
                grid[number] = {}
                for column, cell in enumerate(row, start=1):
                    plain = _unwrap(cell)
                    unwrapped += plain != cell
                    grid[number][column] = Raw(plain)
            tables.append((start, grid, unwrapped))
        else:
            index += 1
    return tables


def read_tables(text: str) -> list[dict[int, dict[int, Raw]]]:
    """Every pipe table of the text, in the order it comes."""
    return [grid for _, grid, _ in find_tables(text)]
