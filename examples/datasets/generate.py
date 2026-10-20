"""Builds the example datasets: every kind of data the second-stage task names, in every format
the service reads, each format twice — a tidy file and one written the way real exports go wrong.

The numbers are synthetic and seeded, so a rebuild gives the same values. Nothing here comes from
the organisers' dataset. The files are committed; the engine tests read them as they are.

    uv run python examples/datasets/generate.py
"""

import json
import random
from datetime import date, datetime, timedelta
from pathlib import Path

import xlsxwriter

ROOT = Path(__file__).parent
#: Workbook metadata is pinned so a rebuild writes the same bytes.
CREATED = datetime(2026, 10, 1, 9, 0, 0)
MONTHS_RU = [
    "январь",
    "февраль",
    "март",
    "апрель",
    "май",
    "июнь",
    "июль",
    "август",
    "сентябрь",
    "октябрь",
    "ноябрь",
    "декабрь",
]
REGIONS = [
    "Москва",
    "Санкт-Петербург",
    "Казань",
    "Новосибирск",
    "Екатеринбург",
    "Нижний Новгород",
    "Самара",
    "Краснодар",
]


def write(path: Path, text: str, encoding: str = "utf-8", newline: str = "\n") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.replace("\n", newline).encode(encoding))


def month_ends(year: int) -> list[date]:
    return [(date(year + (m == 12), m % 12 + 1, 1) - timedelta(days=1)) for m in range(1, 13)]


def revenue_series() -> list[tuple[date, float, float]]:
    """Two years of monthly revenue and costs that grow, with a summer dip."""
    rng = random.Random(14)
    rows = []
    for year in (2024, 2025):
        for index, day in enumerate(month_ends(year)):
            base = 118 + (year - 2024) * 24 + index * 2.4 - (6 if day.month in (7, 8) else 0)
            revenue = round(base + rng.uniform(-3, 3), 1)
            rows.append((day, revenue, round(revenue * rng.uniform(0.61, 0.67), 1)))
    return rows


def csv_files() -> None:
    rows = revenue_series()
    tidy = ["month,revenue_mln_rub,costs_mln_rub"]
    tidy += [f"{day.isoformat()},{revenue},{costs}" for day, revenue, costs in rows]
    write(ROOT / "csv" / "revenue-monthly.csv", "\n".join(tidy) + "\n")

    # A 1C-style export: Windows-1251, semicolons, decimal commas, a comma inside the header,
    # dates with dots, thousands grouped by a no-break space, a totals row, CRLF and blank tails.
    nbsp = "\u00a0"
    lines = ["Выгрузка из 1С: Бухгалтерия, отчёт «Выручка по месяцам»", ""]
    lines.append("Дата;Выручка, тыс. руб.;Расходы, млн руб.;Комментарий")
    for day, revenue, costs in rows:
        thousands = f"{revenue * 1000:.1f}".replace(".", ",")
        head, tail = thousands.split(",")
        grouped = f"{head[:-3]}{nbsp}{head[-3:]},{tail}" if len(head) > 3 else thousands
        comment = "сезонный спад" if day.month in (7, 8) else ""
        lines.append(f"{day:%d.%m.%Y};{grouped};{str(costs).replace('.', ',')};{comment}")
    total = sum(revenue for _, revenue, _ in rows) * 1000
    lines.append(f"Итого;{total:.1f}".replace(".", ",") + ";;")
    write(
        ROOT / "csv" / "revenue-monthly-1c-export.csv",
        "\n".join(lines) + "\n\n\n",
        encoding="cp1251",
        newline="\r\n",
    )


def order_checks() -> list[int]:
    rng = random.Random(7)
    return [max(90, int(rng.lognormvariate(7.6, 0.55))) for _ in range(1000)]


def tsv_files() -> None:
    checks = order_checks()
    tidy = ["order_id\tchannel\tcheck_rub"]
    channels = ["онлайн", "розница", "партнёры"]
    tidy += [f"A{100000 + i}\t{channels[i % 3]}\t{value}" for i, value in enumerate(checks)]
    write(ROOT / "tsv" / "order-checks.tsv", "\n".join(tidy) + "\n")

    # Hand-kept checks: currency signs on either side, refunds in brackets, a typo outlier,
    # gaps written five ways, a duplicated column name, a quoted note with a line break inside
    # and a row with a field too many.
    rng = random.Random(8)
    dirty = ["Номер заказа\tЧек\tЧек\tПримечание"]
    for i, value in enumerate(checks[:400]):
        spaced = f"{value:,}".replace(",", " ")
        cell = rng.choice([f"{spaced} ₽", f"₽{spaced}", f"{value} руб.", spaced])
        note = ""
        if i % 97 == 5:
            cell, note = f"({value})", "возврат"
        if i in (11, 120, 333):
            cell = ["", "н/д", "—"][[11, 120, 333].index(i)]
        if i == 250:
            cell, note = "9 999 999", '"опечатка оператора,\nпроверить"'
        if i == 300:
            dirty.append(f"Б-{i}\t{cell}\t{value}\t{note}\tлишнее поле")
            continue
        dirty.append(f"Б-{i}\t{cell}\t{value}\t{note}")
    write(ROOT / "tsv" / "order-checks-dirty.tsv", "\n".join(dirty) + "\n")


def catalog_rows(count: int) -> list[list[object]]:
    rng = random.Random(21)
    tree = {
        "Электроника": ["Смартфоны", "Ноутбуки", "Наушники"],
        "Дом": ["Посуда", "Текстиль"],
        "Спорт": ["Велосипеды", "Тренажёры", "Туризм"],
    }
    rows: list[list[object]] = []
    for i in range(count):
        category = rng.choice(list(tree))
        rows.append(
            [
                f"SKU-{i + 1:05d}",
                f"Товар {i + 1}",
                category,
                rng.choice(tree[category]),
                round(rng.uniform(190, 98000), 2),
                rng.randint(0, 400),
            ]
        )
    return rows


def reference_files() -> None:
    header = "sku,name,category,subcategory,price_rub,stock"
    lines = [header] + [",".join(str(value) for value in row) for row in catalog_rows(260)]
    write(ROOT / "csv" / "product-catalog.csv", "\n".join(lines) + "\n")


def workbook(path: Path) -> xlsxwriter.Workbook:
    path.parent.mkdir(parents=True, exist_ok=True)
    book = xlsxwriter.Workbook(str(path))
    book.set_properties({"created": CREATED, "author": "examples/datasets"})
    return book


def xlsx_files() -> None:
    rng = random.Random(3)
    book = workbook(ROOT / "xlsx" / "regions-sales.xlsx")
    sheet = book.add_worksheet("Регионы")
    sheet.write_row(0, 0, ["Регион", "Продажи 2024, млн ₽", "Продажи 2025, млн ₽"])
    for row, region in enumerate(REGIONS, start=1):
        before = round(rng.uniform(80, 520), 1)
        sheet.write_row(row, 0, [region, before, round(before * rng.uniform(0.92, 1.31), 1)])
    book.close()

    # The workbook an analyst sends: a merged title over the table, a blank row, a percentage
    # column, numbers typed as text, a formula with a stored result and one without, an error
    # cell, a date column, a hidden helper sheet, an empty sheet and a 300-row reference sheet.
    book = workbook(ROOT / "xlsx" / "regions-report-messy.xlsx")
    bold = book.add_format({"bold": True})
    percent = book.add_format({"num_format": "0.0%"})
    day = book.add_format({"num_format": "dd.mm.yyyy"})
    sheet = book.add_worksheet("Отчёт 2025 📊")
    sheet.merge_range("A1:F1", "Продажи по регионам, 2025 год (млн ₽)", bold)
    sheet.write_row(
        2, 0, ["Регион", "План", "Факт", "Выполнение", "Обновлено", "Комментарий"], bold
    )
    for index, region in enumerate(REGIONS):
        row = 3 + index
        plan = round(rng.uniform(90, 500), 1)
        fact = round(plan * rng.uniform(0.8, 1.2), 1)
        if index == 2:
            sheet.write_string(row, 1, f"{plan:.1f}".replace(".", ","))
        else:
            sheet.write_number(row, 1, plan)
        sheet.write_string(row, 0, region)
        sheet.write_number(row, 2, fact)
        if index == 4:
            sheet.write_formula(row, 3, f"=C{row + 1}/B{row + 1}", percent, "")
        elif index == 6:
            sheet.write_formula(row, 3, f"=C{row + 1}/0", percent, "#DIV/0!")
        else:
            sheet.write_formula(row, 3, f"=C{row + 1}/B{row + 1}", percent, fact / plan)
        sheet.write_datetime(row, 4, datetime(2025, 12, 20 + index % 5), day)
        if index == 1:
            sheet.write_string(row, 5, "данные уточняются")
    helper = book.add_worksheet("служебный")
    helper.write_row(0, 0, ["курс", 92.5])
    helper.hide()
    book.add_worksheet("пустой")
    reference = book.add_worksheet("Справочник")
    reference.write_row(0, 0, ["sku", "name", "category", "subcategory", "price_rub", "stock"])
    for row, values in enumerate(catalog_rows(300), start=1):
        reference.write_row(row, 0, values)
    book.close()


def channel_shares() -> list[tuple[str, float]]:
    return [("Онлайн", 0.46), ("Розница", 0.31), ("Партнёры", 0.15), ("Прочее", 0.08)]


def json_files() -> None:
    records = [{"channel": name, "share": share} for name, share in channel_shares()]
    write(
        ROOT / "json" / "sales-channels.json",
        json.dumps(records, ensure_ascii=False, indent=2) + "\n",
    )

    # Columns and rows from a BI export: a BOM, percentages as strings with and without a space,
    # a decimal comma, a null, an object in a cell, a share that rounding pushes to 101 %,
    # and a column the rows describe by name in a different order.
    weird = {
        "title": "Структура продаж по каналам",
        "columns": [
            {"name": "Канал", "type": "string"},
            {"name": "Доля", "type": "percent"},
            {"name": "Выручка, млн ₽"},
            {"name": "Детали"},
        ],
        "rows": [
            ["Онлайн", "46%", "1 012,4", {"регионы": 8}],
            {"Доля": "31 %", "Канал": "Розница", "Выручка, млн ₽": 682.0, "Детали": None},
            ["Партнёры", "15,5%", None, ["опт", "маркетплейсы"]],
            ["Прочее", "8.5%", "187", None],
        ],
    }
    write(
        ROOT / "json" / "sales-channels-bi-export.json",
        "﻿" + json.dumps(weird, ensure_ascii=False) + "\n",
    )


def text_files() -> None:
    write(
        ROOT / "txt" / "quarter-report.txt",
        """Отчёт команды разработки за III квартал 2025 года

Квартал закрыт по плану. Ниже — задачи по командам: сколько было и сколько закрыто.

| Команда | Задачи | Закрыто | Доля закрытых |
|---|---|---|---|
| Альфа | 40 | 35 | 87,5% |
| Бета | 28 | 20 | 71,4% |
| Гамма | 33 | 33 | 100% |
| Дельта | 19 | 12 | 63,2% |

Вывод: Гамма закрыла всё, Дельте нужен ещё один разработчик.
""",
    )
    # A report pasted from a messenger: a table without outer pipes and with alignment colons,
    # a block copied straight from Excel (tabs), lines with a pipe that are not a table,
    # and a missing value written as «н/д».
    write(
        ROOT / "txt" / "quarter-report-pasted.txt",
        """Привет! Скидываю цифры за квартал | черновик

Команда | Задачи | Закрыто
:--- | ---: | ---:
Альфа | 40 | 35
Бета | 28 | н/д
Гамма | 33 | 33

А это из Excel, по месяцам:
Месяц\tВыручка, млн ₽\tКлиенты
Июль\t1 204,5\t312
Август\t1 156,0\t298
Сентябрь\t1 377,9\t341

Итог: выручка | клиенты растут, кроме августа.
""",
    )


def traffic_rows() -> list[tuple[date, int | None, int | None]]:
    rng = random.Random(5)
    rows = []
    for offset in range(28):
        day = date(2025, 3, 1) + timedelta(days=offset)
        visits = 1200 + offset * 17 + rng.randint(-60, 60)
        orders = int(visits * rng.uniform(0.025, 0.035))
        rows.append(
            (
                day,
                None if offset in (4, 5, 16) else visits,
                None if offset in (5, 9) else orders,
            )
        )
    return rows


def markdown_files() -> None:
    rows = traffic_rows()
    table = ["| Дата | Визиты | Заказы |", "|---|---:|---:|"]
    table += [
        f"| {day.isoformat()} | {'' if visits is None else visits} | "
        f"{'' if orders is None else orders} |"
        for day, visits, orders in rows
    ]
    write(
        ROOT / "md" / "site-traffic-gaps.md",
        "# Трафик сайта, март 2025\n\nСчётчик не работал 5, 6 и 17 марта: эти дни пустые.\n\n"
        + "\n".join(table)
        + "\n",
    )
    # The same month kept by hand in a wiki: bold and code in cells, links, gaps written as
    # «—», «н/д» and «n/a», an escaped pipe inside a cell, an emoji and a non-breaking space.
    hand = ["| **Дата** | Визиты | Заказы | Заметка |", "|:---|---:|---:|---|"]
    for day, visits, orders in rows:
        visit_cell = "—" if visits is None else (f"**{visits}**" if day.day == 1 else f"`{visits}`")
        order_cell = "н/д" if orders is None else (str(orders) if day.day != 10 else "n/a")
        note = ""
        if day.day == 8:
            note = "акция «1+1» \\| [лендинг](https://example.com/promo) 🎉"
        hand.append(f"| {day:%d.%m.%Y} | {visit_cell} | {order_cell} | {note} |")
    write(
        ROOT / "md" / "site-traffic-wiki.md",
        "## Трафик (вики отдела)\n\n> Данные за март. Пропуски — сбой счётчика.\n\n"
        + "\n".join(hand)
        + "\n\nСноска: визиты без ботов.\n",
    )


def invalid_files() -> None:
    write(ROOT / "invalid" / "truncated.json", '[{"channel": "Онлайн", "share": 0.46}, {"chan')
    path = ROOT / "invalid" / "chart-screenshot.csv"
    path.write_bytes(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + bytes(range(256)))
    (ROOT / "invalid" / "empty.csv").write_bytes(b"")
    (ROOT / "invalid" / "legacy.xls").write_bytes(bytes.fromhex("d0cf11e0a1b11ae1") + b"\x00" * 504)
    write(
        ROOT / "invalid" / "notes-without-table.md",
        "# Заметки\n\nЦифр пока нет: выгрузка будет в пятницу.\n",
    )


def main() -> None:
    csv_files()
    reference_files()
    tsv_files()
    xlsx_files()
    json_files()
    text_files()
    markdown_files()
    invalid_files()


if __name__ == "__main__":
    main()
