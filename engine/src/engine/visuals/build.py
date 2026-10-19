"""Public visual build: structured input in, SlideIR and a structural signature out."""

from __future__ import annotations

from typing import Any

from engine.visuals.audit import audit_visual
from engine.visuals.charts import build_chart
from engine.visuals.kpi import build_kpi
from engine.visuals.measure import FontBook
from engine.visuals.signature import structural_signature
from engine.visuals.tables import build_table

DEFERRED = ["semantic-planner-binding"]

_PLACEMENTS = {
    "as-placed",
    "smaller-type-step",
    "wrap-cells",
    "chart-beside-table",
    "chart-above-table",
    "table-above-chart",
}


def capabilities() -> dict[str, Any]:
    """What this layer will draw. Binding it into the semantic planner is still deferred."""
    return {
        "schemaVersion": 1,
        "endpoint": "/v1/visuals",
        "callsModels": False,
        "kinds": ["kpi", "chart", "table"],
        "chartTypes": ["bar", "column", "line", "pie", "area"],
        "variants": ["dense", "balanced", "airy"],
        "native": {
            "table": "pptx-table",
            "chartCategory": "pptx-category-chart",
            "chartXy": "pptx-xy-scatter-lines",
            "kpi": "pptx-text",
        },
        "preserves": [
            "literal",
            "sign",
            "zero",
            "missing",
            "unit",
            "period",
            "source",
            "status",
            "caveat",
        ],
        "refuses": [
            "pie-for-negatives",
            "pie-for-time",
            "pie-for-missing",
            "pie-for-multi-series",
            "shared-axis-mixed-units",
            "delta-divide-by-zero",
            "silent-truncation",
            "extra-slides",
            "missing-as-zero",
        ],
        "deferred": list(DEFERRED),
        "limitations": [
            "KPI figures are native text boxes, which is the SlideIR representation of a figure.",
            "A chart series stores parsed numbers. Trailing zeros stay in the table literal.",
            "Unequal intervals use an XY line. Category charts stay equally spaced.",
            "The semantic planner does not call this endpoint yet.",
        ],
    }


def _fit(
    elements: list[dict[str, Any]], table_overflow: dict[str, int] | None, placement: str
) -> dict[str, Any]:
    text_overflows = [
        element["overflow"]
        for element in elements
        if element.get("kind") == "text" and element.get("overflow")
    ]
    if table_overflow is not None:
        overflow = {
            "code": "table-overflow",
            "lines": table_overflow["lines"],
            "emu": table_overflow["emu"],
            "detail": "Every row stays. The wrapped grid is taller than the box.",
        }
    elif text_overflows:
        worst = max(text_overflows, key=lambda item: int(item["emu"]))
        overflow = {
            "code": "text-overflow",
            "lines": worst["lines"],
            "emu": worst["emu"],
            "detail": "The copy is intact and runs past its box.",
        }
    else:
        overflow = None
    fits = overflow is None
    chosen = placement if placement in _PLACEMENTS else "as-placed"
    return {
        "fits": fits,
        "overflow": overflow,
        "adaptations": [
            {
                "id": chosen,
                "keepsFacts": True,
                "fits": fits,
                "detail": "The variant keeps this arrangement and every supplied fact.",
            },
            {
                "id": "wrap-cells",
                "keepsFacts": True,
                "fits": fits,
                "detail": "Cells and notes wrap onto more lines. They are not cut.",
            },
            {
                "id": "smaller-type-step",
                "keepsFacts": True,
                "fits": fits,
                "detail": "A smaller step of the template scale can be used. Rows are not dropped.",
            },
        ],
    }


def build_visual(request: dict[str, Any]) -> dict[str, Any]:
    """Place one KPI block, chart or table inside `box` using only the template profile."""
    book = FontBook()
    kind = request["block"]["kind"]
    chart: dict[str, Any] | None = None
    limitations: list[str] = []
    table_overflow: dict[str, int] | None = None
    placement = "as-placed"
    if kind == "kpi":
        elements, facts = build_kpi(request, book)
    elif kind == "chart":
        elements, facts, chart, limitations, placement, table_overflow = build_chart(request, book)
    elif kind == "table":
        elements, facts, table_overflow, placement = build_table(request, book)
    else:
        raise ValueError(f"Unsupported visual {kind}.")
    reading = {"facts": facts}
    if book.warnings:
        limitations.append(
            "A template font is not installed. Its name is kept on the text and is not replaced."
        )
    return {
        "schemaVersion": 1,
        "elements": elements,
        "reading": reading,
        "fit": _fit(elements, table_overflow, placement),
        "signature": structural_signature(elements),
        "chart": chart,
        "fontWarnings": book.warnings,
        "issues": audit_visual(request["block"], elements, reading),
        "limitations": limitations,
        "deferred": list(DEFERRED),
    }
