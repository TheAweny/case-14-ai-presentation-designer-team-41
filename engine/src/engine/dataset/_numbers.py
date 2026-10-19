"""Numbers, percentages and dates as the person wrote them, read without guessing.

A cell keeps what the file said. A value is derived from it only when the text allows one reading:
«1 234,56», «1,234.56» and «12,5» are numbers; «1,234» is not, because it is 1234 in one locale
and 1.234 in another. The column may settle it (a neighbour «1,5» shows the comma is decimal); when
it does not, the cell stays text with a diagnostic and no value is made up.
"""

import re
from dataclasses import dataclass
from datetime import date

#: Spaces that group thousands: an ordinary, a no-break and a narrow no-break one.
_SPACES = "    "
_MINUS = "−‒–—"
_CURRENCY = re.compile(r"(?:₽|\$|€|£|руб\.?|р\.|rub|usd|eur)", re.IGNORECASE)
_UNIT_WORD = re.compile(r"\s*(млрд|млн|тыс\.?|k|m|bn)\s*$", re.IGNORECASE)

_PLAIN = re.compile(r"^\d+$")
_DOT_DECIMAL = re.compile(r"^\d+\.\d+$")
_COMMA_DECIMAL = re.compile(r"^\d+,\d+$")
_COMMA_GROUPS = re.compile(r"^\d{1,3}(?:,\d{3})+$")
_DOT_GROUPS = re.compile(r"^\d{1,3}(?:\.\d{3}){2,}$")
_BOTH_DOT_LAST = re.compile(r"^\d{1,3}(?:,\d{3})+\.\d+$")
_BOTH_COMMA_LAST = re.compile(r"^\d{1,3}(?:\.\d{3})+,\d+$")
_SPACE_GROUPS = re.compile(r"^\d{1,3}(?: \d{3})+$")
_SPACE_GROUPS_DOT = re.compile(r"^\d{1,3}(?: \d{3})+\.\d+$")
_SPACE_GROUPS_COMMA = re.compile(r"^\d{1,3}(?: \d{3})+,\d+$")

_ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_DOTTED_DATE = re.compile(r"^(\d{1,2})\.(\d{1,2})\.(\d{4})$")
_SLASHED_DATE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")


@dataclass(frozen=True, slots=True)
class Number:
    """What a text says as a number, or why it cannot say one."""

    value: float | None
    unit: str = ""
    #: The text reads as a number in two ways; `candidates` holds both, `value` is None.
    ambiguous: bool = False
    candidates: tuple[float, ...] = ()
    #: How the decimal separator was read, when the text shows it: «.», «,» or empty.
    decimal: str = ""


def _clean(raw: str) -> tuple[str, str, bool]:
    """The digits and separators of a text, the unit it carried and whether it was negative."""
    text = raw.strip().translate(str.maketrans({c: "-" for c in _MINUS}))
    negative = False
    if text.startswith("(") and text.endswith(")"):
        negative, text = True, text[1:-1].strip()
    unit = ""
    if text.endswith("%"):
        unit, text = "%", text[:-1].strip()
    else:
        word = _UNIT_WORD.search(text)
        if word:
            unit, text = word.group(1).lower().rstrip("."), text[: word.start()].strip()
    text = _CURRENCY.sub("", text).strip()
    if text.startswith("-"):
        negative, text = True, text[1:].strip()
    elif text.startswith("+"):
        text = text[1:].strip()
    for space in _SPACES:
        text = text.replace(space, " ")
    return re.sub(r" +", " ", text), unit, negative


def parse_number(raw: str, decimal_hint: str = "") -> Number:
    """Read a text as a number.

    `decimal_hint` is the decimal separator the column showed elsewhere («.» or «,»): it settles
    a text that alone would be ambiguous, such as «1,234».
    """
    text, unit, negative = _clean(raw)
    if not text or not re.search(r"\d", text):
        return Number(None)
    sign = -1.0 if negative else 1.0

    def done(value: float, decimal: str = "") -> Number:
        return Number(sign * value, unit, decimal=decimal)

    if _PLAIN.match(text):
        return done(float(text))
    if _SPACE_GROUPS.match(text):
        return done(float(text.replace(" ", "")))
    if _DOT_DECIMAL.match(text) or _BOTH_DOT_LAST.match(text):
        return done(float(text.replace(",", "")), ".")
    if _BOTH_COMMA_LAST.match(text):
        return done(float(text.replace(".", "").replace(",", ".")), ",")
    if _SPACE_GROUPS_DOT.match(text):
        return done(float(text.replace(" ", "")), ".")
    if _SPACE_GROUPS_COMMA.match(text):
        return done(float(text.replace(" ", "").replace(",", ".")), ",")
    if _COMMA_GROUPS.match(text) and text.count(",") > 1:
        return done(float(text.replace(",", "")))
    if _DOT_GROUPS.match(text):
        return done(float(text.replace(".", "")))
    if (
        _COMMA_DECIMAL.match(text)
        or _COMMA_GROUPS.match(text)
        or re.match(r"^\d{1,3}\.\d{3}$", text)
    ):
        return _separated(text, sign, unit, decimal_hint)
    return Number(None)


def _separated(text: str, sign: float, unit: str, hint: str) -> Number:
    """One separator and three digits after it, or a decimal one: «12,5», «1,234», «1.234»."""
    separator = "," if "," in text else "."
    head, tail = text.split(separator)
    if len(tail) != 3:
        # Not a thousands group: the separator is the decimal one.
        return Number(sign * float(f"{head}.{tail}"), unit, decimal=separator)
    as_decimal = float(f"{head}.{tail}")
    if not head.strip("0"):
        # «0,125»: a thousands group never follows a zero.
        return Number(sign * as_decimal, unit, decimal=separator)
    as_grouped = float(head + tail)
    if hint == separator:
        return Number(sign * as_decimal, unit, decimal=separator)
    if hint:
        return Number(sign * as_grouped, unit)
    return Number(None, unit, True, (sign * as_decimal, sign * as_grouped))


@dataclass(frozen=True, slots=True)
class DateValue:
    iso: str | None
    ambiguous: bool = False
    candidates: tuple[str, ...] = ()


def parse_date(raw: str) -> DateValue | None:
    """A calendar date as ISO text, `None` for a text that is no date.

    «2025-03-04» and «04.03.2025» (day first, as written with dots) have one reading. «04/03/2025»
    has two unless a part is above 12, and then no date is made up.
    """
    text = raw.strip()
    iso = _ISO_DATE.match(text)
    if iso:
        return _valid(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
    dotted = _DOTTED_DATE.match(text)
    if dotted:
        return _valid(int(dotted.group(3)), int(dotted.group(2)), int(dotted.group(1)))
    slashed = _SLASHED_DATE.match(text)
    if slashed:
        first, second, year = int(slashed.group(1)), int(slashed.group(2)), int(slashed.group(3))
        day_first = _valid(year, second, first)
        month_first = _valid(year, first, second)
        if day_first.iso and month_first.iso and day_first.iso != month_first.iso:
            return DateValue(None, True, (day_first.iso, month_first.iso))
        return day_first if day_first.iso else month_first
    return None


def _valid(year: int, month: int, day: int) -> DateValue:
    try:
        return DateValue(date(year, month, day).isoformat())
    except ValueError:
        return DateValue(None)
