"""Synthetic profiles and structured visuals. Nothing here names a product template."""

from __future__ import annotations

from typing import Any

META = {"source": "observed", "count": 3, "share": 0.9, "confidence": 0.8, "parts": ["synthetic"]}

CONTENT_BOX = {"x": 400_000, "y": 900_000, "cx": 11_000_000, "cy": 5_200_000}


def design_system(
    font: str = "DejaVu Sans", accent: str = "123456", gutter: int = 182_880
) -> dict[str, Any]:
    def colour(role: str, hex_value: str) -> dict[str, Any]:
        return {"role": role, "hex": hex_value, "meta": META}

    def step(role: str, size: float, bold: bool = False) -> dict[str, Any]:
        return {
            "role": role,
            "font": font,
            "sizePt": size,
            "bold": bold,
            "italic": False,
            "lineSpacing": 1.15,
            "colorRole": "text",
            "meta": META,
        }

    return {
        "schemaVersion": 1,
        "templateHash": "ab" * 32,
        "aspect": "16:9",
        "palette": [
            colour("background", "F7F4EF"),
            colour("surface", "E7EEF2"),
            colour("text", "1C2430"),
            colour("text-muted", "5C6B7A"),
            colour("text-on-accent", "FFFFFF"),
            colour("accent", accent),
            colour("accent-alt", "8A5A2A"),
            colour("line", "C5D0DC"),
            colour("positive", "1F7A4D"),
            colour("negative", "A33B3B"),
        ],
        "surfaces": [
            {
                "tone": "light",
                "background": "F7F4EF",
                "text": "1C2430",
                "accent": accent,
                "meta": META,
            }
        ],
        "typeFamilies": [{"role": "primary", "font": font, "declared": font, "meta": META}],
        "typeScale": [
            step("title", 32, True),
            step("body", 16),
            step("caption", 12),
            step("kpi-value", 28, True),
            step("kpi-caption", 13),
        ],
        "grid": {
            "slideCx": 12_192_000,
            "slideCy": 6_858_000,
            "marginLeft": 457_200,
            "marginRight": 457_200,
            "marginTop": 365_760,
            "marginBottom": 365_760,
            "columns": 12,
            "gutter": gutter,
            "baseline": 114_300,
            "meta": META,
        },
        "strokes": [],
        "radii": [],
        "shadows": {"present": False, "meta": META},
        "protectedZones": [],
        "warnings": [],
    }


def source(quote: str, status: str = "unverified", item_id: str = "pack-1") -> dict[str, str]:
    return {"itemId": item_id, "quote": quote, "status": status}


def present(literal: str, value: float) -> dict[str, Any]:
    return {"state": "present", "literal": literal, "value": value}


def missing() -> dict[str, str]:
    return {"state": "missing"}


def request_for(
    block: dict[str, Any],
    variant: str = "balanced",
    *,
    font: str = "DejaVu Sans",
    accent: str = "123456",
    box: dict[str, int] | None = None,
    element_id: str = "visual",
    language: str = "ru",
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "designSystem": design_system(font, accent),
        "variant": variant,
        "elementId": element_id,
        "box": box or CONTENT_BOX,
        "language": language,
        "block": block,
    }


LONG_CAPTION = (
    "Среднегодовая загрузка производственных линий восточного филиала с учётом планового ремонта"
)


def kpi_block() -> dict[str, Any]:
    return {
        "kind": "kpi",
        "items": [
            {
                "value": present("0", 0),
                "unit": "шт",
                "unitAmbiguous": False,
                "caption": "Остаток на складе",
                "period": "2024",
                "periodKnown": True,
                "sources": [source("Остаток 0 шт за 2024.")],
            },
            {
                "value": present("-12,5", -12.5),
                "unit": "%",
                "unitAmbiguous": False,
                "caption": "Отклонение маржи",
                "period": "1 кв. 2025",
                "periodKnown": True,
                "sources": [source("Отклонение маржи -12,5% в 1 кв. 2025.")],
            },
            {
                "value": present("1250000000.50", 1_250_000_000.50),
                "unit": "₽",
                "unitAmbiguous": False,
                "caption": "Выручка",
                "period": "2024",
                "periodKnown": True,
                "sources": [source("Выручка 1250000000.50 ₽ за 2024.")],
            },
            {
                "value": present("8", 8),
                "unit": "шт",
                "unitAmbiguous": False,
                "caption": "Отгрузки при нулевой базе",
                "period": "2025",
                "periodKnown": True,
                "comparison": {"base": present("0", 0), "baseUnit": "шт", "basePeriod": "2024"},
                "sources": [source("Отгрузки 8 шт в 2025 при базе 0 в 2024.")],
            },
            {
                "value": present("10", 10),
                "unit": "шт",
                "unitAmbiguous": False,
                "caption": "Отгрузки без базы",
                "period": "2025",
                "periodKnown": True,
                "comparison": {"base": missing(), "baseUnit": "шт", "basePeriod": "2024"},
                "sources": [source("База за 2024 в источнике не указана.")],
            },
            {
                "value": present("4", 4),
                "unit": "усл. ед.",
                "unitAmbiguous": True,
                "caption": LONG_CAPTION,
                "period": "",
                "periodKnown": False,
                "caveat": "Единица в источнике не расшифрована.",
                "sources": [source("Показатель 4 усл. ед.", status="unverified")],
            },
            {
                "value": missing(),
                "unit": "чел.",
                "unitAmbiguous": False,
                "caption": "Текучесть",
                "period": "2024",
                "periodKnown": True,
                "sources": [source("Текучесть за 2024 в источнике отсутствует.")],
            },
        ],
    }


def category_chart() -> dict[str, Any]:
    return {
        "kind": "chart",
        "intent": "category-comparison",
        "categories": [
            {"label": "Север"},
            {"label": "Юг"},
            {"label": "Восток"},
        ],
        "series": [
            {
                "name": "Факт",
                "unit": "млн ₽",
                "values": [present("0", 0), present("-3.5", -3.5), present("12", 12)],
            },
            {
                "name": "План с очень длинным названием ряда, которое нельзя обрезать в легенде",
                "unit": "млн ₽",
                "values": [present("4", 4), missing(), present("9", 9)],
            },
        ],
        "xTitle": "Филиал",
        "yTitle": "",
        "sources": [source("Факт и план по филиалам, млн ₽. По югу план не опубликован.")],
        "caveat": "План южного филиала в источнике отсутствует.",
    }


def time_chart() -> dict[str, Any]:
    return {
        "kind": "chart",
        "intent": "time-series",
        "categories": [
            {"label": "2020", "position": 2020},
            {"label": "2021", "position": 2021},
            {"label": "2024", "position": 2024},
            {"label": "2025", "position": 2025},
        ],
        "series": [
            {
                "name": "Запас",
                "unit": "сутки",
                "values": [present("10", 10), present("0", 0), present("-2", -2), missing()],
            }
        ],
        "requestedType": "pie",
        "xTitle": "Год",
        "yTitle": "Запас",
        "sources": [source("Запас в сутках: 10, 0, -2, далее данных нет.")],
    }


def mixed_chart() -> dict[str, Any]:
    return {
        "kind": "chart",
        "intent": "category-comparison",
        "categories": [{"label": "A"}, {"label": "B"}],
        "series": [
            {"name": "Выручка", "unit": "млн ₽", "values": [present("2", 2), present("3", 3)]},
            {"name": "Штат", "unit": "чел.", "values": [present("10", 10), present("12", 12)]},
        ],
        "xTitle": "Год",
        "yTitle": "",
        "sources": [source("Выручка в млн ₽ и штат в чел. не складываются.")],
    }


def single_chart() -> dict[str, Any]:
    return {
        "kind": "chart",
        "intent": "time-series",
        "categories": [{"label": "2025", "position": 2025}],
        "series": [
            {"name": "Остаток", "unit": "шт", "values": [present("0", 0)]},
        ],
        "requestedType": "line",
        "xTitle": "Год",
        "yTitle": "Остаток",
        "sources": [source("Остаток на 2025 равен 0 шт.")],
    }


def table_block() -> dict[str, Any]:
    return {
        "kind": "table",
        "columns": [
            {"header": "Показатель", "kind": "text"},
            {"header": "Значение", "kind": "number"},
            {"header": "Единица", "kind": "unit"},
        ],
        "rows": [
            {
                "cells": [
                    {"text": "Ёмкость → запас", "missing": False},
                    {"text": "1250000000.50", "missing": False},
                    {"text": "₽", "missing": False},
                ]
            },
            {
                "cells": [
                    {"text": "Отклонение", "missing": False},
                    {"text": "-12,5", "missing": False},
                    {"text": "%", "missing": False},
                ]
            },
            {
                "cells": [
                    {"text": "Остаток", "missing": False},
                    {"text": "0", "missing": False},
                    {"text": "шт", "missing": False},
                ]
            },
            {
                "cells": [
                    {
                        "text": "Очень длинная ячейка " + LONG_CAPTION,
                        "missing": False,
                    },
                    {"text": "", "missing": True},
                    {"text": "усл. ед.", "missing": False},
                ]
            },
        ],
        "sources": [source("Строки скопированы из пакета, включая 0 и пропуск.")],
        "notes": "Ноль и пропуск стоят в разных строках и не заменяют друг друга.",
        "caveat": "Пропуск не равен нулю.",
    }
