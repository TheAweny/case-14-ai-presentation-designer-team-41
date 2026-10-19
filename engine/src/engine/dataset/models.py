"""The shape of an extracted dataset.

A provisional contract: the engine owns it until the shared contracts take a form of it
(`SourceRef`, `DataProfile`), and then these models are generated from them. Every cell carries its
reference, the text as the file held it and, only when the text allows one reading, a value.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CellKind = Literal["number", "text", "date", "boolean", "empty"]
Severity = Literal["error", "warning", "info"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Diagnostic(_Model):
    """Something the reader found in the file that the user, or a later step, has to know."""

    code: str
    severity: Severity
    message: str
    sheet: str | None = None
    ref: str | None = None


class Cell(_Model):
    ref: str = Field(description="Spreadsheet reference of the cell in its sheet, such as B3.")
    raw: str | None = Field(description="The text as the file held it; null for an empty cell.")
    kind: CellKind
    value: float | str | bool | None = Field(
        default=None,
        description="A number, an ISO date, a boolean or the text; null when the text allows no "
        "single reading, and never zero for an empty cell.",
    )
    unit: str = Field(default="", description="A percent sign or a unit word that came with it.")
    candidates: list[float | str] = Field(
        default_factory=list,
        description="The readings of an ambiguous text, none of which was chosen.",
    )


class Row(_Model):
    row: int = Field(description="Row number in the source, from 1.")
    cells: list[Cell]


class Column(_Model):
    columnId: str  # noqa: N815 - the contract names are camelCase
    index: int
    ref: str
    header: str | None
    kind: CellKind = Field(description="What most of the non-empty cells of the column are.")
    decimal: str = Field(default="", description="Decimal separator the column showed, if any.")


class Sheet(_Model):
    sheetId: str  # noqa: N815
    name: str
    index: int
    state: Literal["visible", "hidden"] = "visible"
    range: str = Field(description="Cells the sheet holds, such as A1:D200; empty for no cells.")
    headerRow: int | None = Field(description="Row of the column headers, null when none.")  # noqa: N815
    columns: list[Column]
    rows: list[Row] = Field(description="Every row below the header, none left out.")
    mergedRanges: list[str] = Field(default_factory=list)  # noqa: N815


class Source(_Model):
    fileName: str  # noqa: N815
    mediaType: str  # noqa: N815
    bytes: int
    sha256: str


class Dataset(_Model):
    schemaVersion: Literal[1] = 1  # noqa: N815
    datasetId: str  # noqa: N815
    status: Literal["ok", "partial", "failed"]
    source: Source
    sheets: list[Sheet]
    diagnostics: list[Diagnostic]
