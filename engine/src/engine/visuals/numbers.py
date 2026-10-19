"""Literals, missing values, and deltas that refuse a zero or absent base."""

from __future__ import annotations

from typing import Any


def phrases(language: str) -> dict[str, str]:
    """Status labels. They are not measured facts and they do not depend on a template."""
    if language.lower().startswith("ru"):
        return {
            "missing": "нет данных",
            "period_unknown": "период не указан",
            "no_base": "сравнение недоступно: нет базы",
            "no_value": "сравнение недоступно: нет значения",
            "zero_base": "относительное сравнение недоступно: база равна нулю",
            "mixed_units": "сравнение недоступно: разные единицы",
            "ambiguous": "единица указана неоднозначно",
            "source": "источник {item_id}, {status}",
            "unit_label": "единица: {unit}",
            "period_label": "период: {period}",
            "category": "категория",
            "notes": "примечание",
            "versus": "к",
        }
    return {
        "missing": "no data",
        "period_unknown": "period not stated",
        "no_base": "comparison unavailable: base is missing",
        "no_value": "comparison unavailable: value is missing",
        "zero_base": "relative comparison unavailable: base is zero",
        "mixed_units": "comparison unavailable: units differ",
        "ambiguous": "unit is ambiguous",
        "source": "source {item_id}, {status}",
        "unit_label": "unit: {unit}",
        "period_label": "period: {period}",
        "category": "category",
        "notes": "note",
        "versus": "vs",
    }


def parse_literal(literal: str) -> float | None:
    """Parse a supplied literal. Grouping spaces are allowed; a second decimal mark is not."""
    text = literal.strip().replace("\u00a0", "").replace(" ", "")
    if not text:
        return None
    if text.count(",") == 1 and "." not in text:
        text = text.replace(",", ".")
    if text.count(".") > 1:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def agrees(literal: str, value: float) -> bool:
    parsed = parse_literal(literal)
    if parsed is None:
        return False
    scale = max(1.0, abs(value))
    return abs(parsed - value) <= 1e-9 * scale


def require_measured(measured: dict[str, Any], label: str) -> None:
    """Refuse a present value whose literal disagrees, and a missing value that still has one."""
    state = measured.get("state")
    if state == "missing":
        if measured.get("literal") not in (None, "") or measured.get("value") is not None:
            raise ValueError(f"{label} is missing and must not carry a literal or a value.")
        return
    if state != "present":
        raise ValueError(f"{label} has an unknown state.")
    literal = measured.get("literal")
    value = measured.get("value")
    if (
        not isinstance(literal, str)
        or isinstance(value, bool)
        or not isinstance(value, int | float)
    ):
        raise ValueError(f"{label} is present and needs a literal and a finite value.")
    if not agrees(literal, float(value)):
        raise ValueError(f"{label} literal does not match its value.")


def _decimals(literal: str) -> int:
    text = literal.strip().replace("\u00a0", "").replace(" ", "")
    separator = "," if "," in text and "." not in text else "."
    if separator not in text:
        return 0
    fraction = text.split(separator)[-1]
    return len(fraction) if fraction.isdigit() else 0


def _comma(literals: list[str]) -> bool:
    for literal in literals:
        text = literal.replace("\u00a0", "").replace(" ", "")
        if "," in text and "." not in text:
            return True
    return False


def format_signed(number: float, places: int, comma: bool) -> str:
    """Fixed-point form that keeps the sign and the requested number of fractional digits."""
    sign = "-" if number < 0 else "+" if number > 0 else ""
    body = f"{abs(number):.{places}f}"
    if comma:
        body = body.replace(".", ",")
    return f"{sign}{body}" if sign else body


def display_measured(measured: dict[str, Any], missing_label: str) -> str:
    if measured.get("state") == "missing":
        return missing_label
    return str(measured["literal"])


def delta_lines(item: dict[str, Any], words: dict[str, str]) -> list[tuple[str, str]]:
    """Absolute delta when both sides share a unit. Percent only when the base is not 0."""
    comparison = item.get("comparison")
    if not comparison:
        return []
    current = item["value"]
    base = comparison["base"]
    require_measured(base, "comparison base")
    unit = str(item.get("unit") or "")
    base_unit = str(comparison.get("baseUnit") or "")
    if current.get("state") != "present":
        return [("note", words["no_value"])]
    if base.get("state") != "present":
        return [("note", words["no_base"])]
    if unit != base_unit:
        return [("note", words["mixed_units"])]
    current_value = float(current["value"])
    base_value = float(base["value"])
    places = max(_decimals(str(current["literal"])), _decimals(str(base["literal"])))
    comma = _comma([str(current["literal"]), str(base["literal"])])
    signed = format_signed(current_value - base_value, places, comma)
    period = str(comparison.get("basePeriod") or "")
    unit_suffix = f" {unit}" if unit else ""
    period_suffix = f" {words['versus']} {period}" if period else ""
    lines = [("delta", f"Δ {signed}{unit_suffix}{period_suffix}")]
    if base_value == 0:
        lines.append(("note", words["zero_base"]))
        return lines
    relative = (current_value - base_value) / base_value * 100
    rel_places = 1 if places == 0 else places
    lines.append(("delta", f"Δ {format_signed(relative, rel_places, comma)}%"))
    return lines
