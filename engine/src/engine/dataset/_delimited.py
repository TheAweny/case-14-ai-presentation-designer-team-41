"""Text tables with a delimiter: CSV, TSV and what people call CSV."""

import csv
import io
from collections import Counter

from engine.dataset._build import Raw
from engine.dataset.models import Diagnostic

_DELIMITERS = (",", ";", "\t", "|")
#: Lines looked at to tell the delimiter: enough to agree, few enough to be quick.
_SAMPLE = 60


def decode(data: bytes, diagnostics: list[Diagnostic]) -> str | None:
    """The text of a file, or None when it is not text. A guessed encoding is said so."""
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        text = data.decode("utf-16", errors="replace")
    else:
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = data.decode("cp1251", errors="replace")
            diagnostics.append(
                Diagnostic(
                    code="encoding-guessed",
                    severity="warning",
                    message="The file is not UTF-8; it was read as Windows-1251.",
                )
            )
    control = sum(1 for char in text if ord(char) < 32 and char not in "\t\r\n")
    if "\x00" in text or control > max(8, len(text) // 100):
        diagnostics.append(
            Diagnostic(
                code="unreadable",
                severity="error",
                message="The file is not a text table: it holds binary data.",
            )
        )
        return None
    return text


def _consistency(lines: list[str], delimiter: str) -> tuple[float, int]:
    """How evenly a delimiter splits the lines: the share of lines with the commonest width."""
    widths = [len(row) for row in csv.reader(lines, delimiter=delimiter) if row]
    if not widths:
        return 0.0, 0
    width, count = Counter(widths).most_common(1)[0]
    return count / len(widths), width


def detect_delimiter(text: str, suffix: str) -> str:
    if suffix == ".tsv":
        return "\t"
    lines = [line for line in text.splitlines() if line.strip()][:_SAMPLE]
    best, best_score = ",", 0.0
    for delimiter in _DELIMITERS:
        share, width = _consistency(lines, delimiter)
        # A delimiter that splits every line in the same way wins; more columns break a tie.
        score = share * 100 + min(width, 50) if width >= 2 else 0.0
        if score > best_score:
            best, best_score = delimiter, score
    return best


def read_delimited(
    text: str, suffix: str, diagnostics: list[Diagnostic], sheet: str
) -> dict[int, dict[int, Raw]]:
    """Every record of the text as cells; a short record is padded, a long one widens the sheet."""
    delimiter = detect_delimiter(text, suffix)
    csv.field_size_limit(10_000_000)
    grid: dict[int, dict[int, Raw]] = {}
    widths: Counter[int] = Counter()
    for number, record in enumerate(csv.reader(io.StringIO(text), delimiter=delimiter), start=1):
        if not record:
            continue
        widths[len(record)] += 1
        grid[number] = {column: Raw(field) for column, field in enumerate(record, start=1)}
    if len(widths) > 1:
        usual = widths.most_common(1)[0][0]
        odd = sum(count for width, count in widths.items() if width != usual)
        diagnostics.append(
            Diagnostic(
                code="ragged-rows",
                severity="warning",
                message=f"{odd} row(s) have a different number of fields than the usual {usual}; "
                "missing fields are empty and none was dropped.",
                sheet=sheet,
            )
        )
    return grid
