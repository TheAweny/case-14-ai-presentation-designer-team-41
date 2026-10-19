"""Checks that a visual still shows the structured input.

These judge a spec against the SlideIR it became. They do not promote a source to grounded,
and they are not part of the editor audit registry: the editor does not have the spec.
"""

from __future__ import annotations

from typing import Any


def _sources(block: dict[str, Any]) -> list[dict[str, Any]]:
    if block["kind"] == "kpi":
        return [source for item in block["items"] for source in item["sources"]]
    return list(block.get("sources") or [])


def _issue(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


def audit_visual(
    block: dict[str, Any], elements: list[dict[str, Any]], reading: dict[str, Any]
) -> list[dict[str, str]]:
    """Empty when the picture agrees with the input. A hit is a failed check."""
    issues: list[dict[str, str]] = []
    charts = [element for element in elements if element.get("kind") == "chart"]
    tables = [element for element in elements if element.get("kind") == "table"]
    for element in charts:
        if element.get("chartType") != "pie":
            continue
        bad = len(element["series"]) != 1 or any(
            value is None or value < 0 for series in element["series"] for value in series["values"]
        )
        if bad:
            issues.append(
                _issue(
                    "pie-unsuitable",
                    "A pie is only drawn for one non-negative series with no missing points.",
                )
            )
        units = {series.get("unit") for series in element["series"] if series.get("unit")}
        if len(units) > 1:
            issues.append(_issue("mixed-unit-axis", "A pie cannot combine different units."))
    for element in charts:
        units = {str(series.get("unit")) for series in element["series"] if series.get("unit")}
        if len(units) > 1:
            issues.append(
                _issue("mixed-unit-axis", "Series with different units share one chart axis.")
            )
    if block["kind"] == "chart":
        for series in block["series"]:
            for index, measured in enumerate(series["values"]):
                if measured.get("state") != "missing":
                    continue
                for element in charts:
                    for drawn in element["series"]:
                        if drawn["name"] != series["name"]:
                            continue
                        if index < len(drawn["values"]) and drawn["values"][index] == 0:
                            issues.append(
                                _issue(
                                    "missing-rendered-as-zero",
                                    f"{series['name']} is missing at {index} and drawn as zero.",
                                )
                            )
                for element in tables:
                    # The category column is first; series follow the input order.
                    column = 1 + block["series"].index(series)
                    if index < len(element["rows"]) and element["rows"][index][column] == "0":
                        issues.append(
                            _issue(
                                "missing-rendered-as-zero",
                                f"{series['name']} is missing in the source table and reads as 0.",
                            )
                        )
        if tables and len(tables[0]["rows"]) < len(block["categories"]):
            issues.append(_issue("table-row-loss", "The source table dropped a category."))
    if block["kind"] == "table":
        expected = len(block["rows"])
        if not tables or len(tables[0]["rows"]) < expected:
            issues.append(_issue("table-row-loss", "The table dropped a row."))
    if block["kind"] == "kpi":
        for item in block["items"]:
            comparison = item.get("comparison") or {}
            base = comparison.get("base") or {}
            if base.get("state") == "present" and base.get("value") == 0:
                for fact in reading.get("facts") or []:
                    text = str(fact.get("text") or "")
                    if fact.get("kind") == "delta" and text.endswith("%"):
                        issues.append(
                            _issue(
                                "delta-on-zero-base",
                                "A percent delta was shown from a base of zero.",
                            )
                        )
    for source in _sources(block):
        if source.get("status") != "unverified":
            continue
        for fact in reading.get("facts") or []:
            if fact.get("kind") != "source" or source["itemId"] not in str(fact.get("text") or ""):
                continue
            if fact.get("sourceStatus") != "unverified":
                issues.append(
                    _issue(
                        "source-status-upgraded",
                        f"Source {source['itemId']} was shown as {fact.get('sourceStatus')}.",
                    )
                )
    return issues
