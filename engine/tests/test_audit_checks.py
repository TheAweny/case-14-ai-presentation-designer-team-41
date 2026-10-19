"""Deterministic audit: every check passes a clean slide and fires on one that breaks its rule.

The clean slide sits on the template grid, uses its fonts, sizes and colours, and keeps to the
density limits. Each case below breaks exactly the rule of one check, so a check that fires on
the clean slide or stays silent on its case fails here.
"""

import copy
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from engine.api._profiles import deterministic_profile
from engine.checks import DETERMINISTIC_CHECKS, audit_deck

_FIXTURES = Path(__file__).resolve().parents[2] / "packages/contracts/fixtures"
_DS: dict[str, Any] = json.loads((_FIXTURES / "DesignSystem.json").read_text("utf-8"))["valid"][0][
    "payload"
]
_GRID = _DS["grid"]
_LEFT = _GRID["marginLeft"]
_WIDTH = _GRID["slideCx"] - _LEFT - _GRID["marginRight"]
_TITLE_BOX = {"x": _LEFT, "y": _GRID["marginTop"], "cx": _WIDTH, "cy": 914_400}
_BODY_BOX = {"x": _LEFT, "y": 1_828_800, "cx": _WIDTH, "cy": 3_200_400}
_LOGO = _DS["protectedZones"][0]


def _text(
    element_id: str, role: str, box: dict[str, int], *lines: str, size: float = 16
) -> dict[str, Any]:
    return {
        "kind": "text",
        "elementId": element_id,
        "role": role,
        "box": dict(box),
        "sourceShapeId": None,
        "paragraphs": [
            {
                "level": 0,
                "runs": [
                    {
                        "text": line,
                        "font": "",
                        "sizePt": size,
                        "bold": None,
                        "italic": None,
                        "color": "",
                    }
                ],
                "lineSpacing": None,
            }
            for line in lines
        ],
        "overflow": None,
    }


def _clean_slide() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "slideId": "s1",
        "variant": "balanced",
        "index": 0,
        "patternId": "title-and-list",
        "slideCx": _GRID["slideCx"],
        "slideCy": _GRID["slideCy"],
        "elements": [
            _text("title", "title", _TITLE_BOX, "Выручка выросла на 12%", size=40),
            _text(
                "list",
                "bullet-list",
                _BODY_BOX,
                "Удержание клиентов 94%",
                "Новые рынки дали треть роста",
                "Средний чек вырос на 8%",
                "Повторные заказы выросли вдвое",
                "Доля онлайн-продаж дошла до 61%",
                "Срок доставки сократился на два дня",
            ),
        ],
    }


def _catalog() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "templateHash": _DS["templateHash"],
        "patterns": [
            {
                "patternId": "title-and-list",
                "sourceParts": ["/ppt/slideLayouts/slideLayout2.xml"],
                "intents": ["bullets"],
                "slots": [
                    {
                        "slotId": "title",
                        "role": "title",
                        "box": _TITLE_BOX,
                        "optional": False,
                        "maxChars": 60,
                    },
                    {
                        "slotId": "body",
                        "role": "bullet-list",
                        "box": _BODY_BOX,
                        "optional": False,
                        "maxChars": 600,
                    },
                ],
                "occurrences": 4,
                "density": 0.5,
            }
        ],
    }


def _request(
    slide: dict[str, Any], media: dict[str, Any] | None = None, *more: dict[str, Any]
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "deckId": "deck",
        "slides": [slide, *more],
        "designSystem": _DS,
        "patternCatalog": _catalog(),
        "mediaSizes": media or {},
    }


def _fired(
    slide: dict[str, Any], media: dict[str, Any] | None = None, *more: dict[str, Any]
) -> set[str]:
    report = audit_deck(_request(slide, media, *more), "default", deterministic_profile("default"))
    return {finding["checkId"] for finding in report["findings"]}


def _element(slide: dict[str, Any], element_id: str) -> dict[str, Any]:
    return next(e for e in slide["elements"] if e["elementId"] == element_id)


def _run(slide: dict[str, Any], element_id: str) -> dict[str, Any]:
    return _element(slide, element_id)["paragraphs"][0]["runs"][0]


def _image(box: dict[str, int], **extra: Any) -> dict[str, Any]:
    return {
        "kind": "image",
        "elementId": "picture",
        "role": "image",
        "box": box,
        "sourceShapeId": None,
        "mediaPart": "ppt/media/photo.png",
        "fit": "cover",
        **extra,
    }


def _slide_bounds(s: dict[str, Any]) -> None:
    s["elements"].append(
        _image({"x": 10_500_000, "y": 1_828_800, "cx": 3_000_000, "cy": 1_000_000})
    )


def _text_clipped(s: dict[str, Any]) -> None:
    _element(s, "title")["box"]["y"] = -300_000


def _overlap(s: dict[str, Any]) -> None:
    s["elements"].append(
        {
            "kind": "chart",
            "elementId": "chart",
            "role": "chart",
            "box": {"x": _LEFT, "y": 2_500_000, "cx": _WIDTH // 2, "cy": 2_000_000},
            "sourceShapeId": None,
            "chartType": "bar",
            "categories": ["Q1", "Q2"],
            "series": [{"name": "Выручка", "values": [1, 2]}],
            "xTitle": "",
            "yTitle": "",
        }
    )


def _text_overflow(s: dict[str, Any]) -> None:
    body = _element(s, "list")
    body["box"]["cy"] = 600_000
    body["paragraphs"] = body["paragraphs"] * 4


def _word_break(s: dict[str, Any]) -> None:
    body = _element(s, "list")
    body["box"] = {**body["box"], "cx": 1_500_000}
    _run(s, "list")["text"] = "Достопримечательностей"


def _grid_alignment(s: dict[str, Any]) -> None:
    body = _element(s, "list")
    # Off every column edge of the 12-column grid, and off centre.
    body["box"]["x"] = _LEFT + 300_000
    body["box"]["cx"] = _WIDTH - 1_000_000


def _safe_margins(s: dict[str, Any]) -> None:
    _element(s, "list")["box"]["x"] = _LEFT // 3


def _image_aspect(s: dict[str, Any]) -> None:
    crop = {"l": 0.0, "t": 0.0, "r": 0.0, "b": 0.0}
    s["elements"].append(
        _image({"x": _LEFT, "y": 5_100_000, "cx": 1_000_000, "cy": 1_000_000}, crop=crop)
    )


def _font_usage(s: dict[str, Any]) -> None:
    _run(s, "list")["font"] = "Comic Sans MS"


def _type_scale(s: dict[str, Any]) -> None:
    _run(s, "list")["sizePt"] = 17


def _palette(s: dict[str, Any]) -> None:
    _run(s, "list")["color"] = "FF00AA"


def _template_layout(s: dict[str, Any]) -> None:
    s["patternId"] = "invented-by-the-generator"


def _protected_zones(s: dict[str, Any]) -> None:
    moved = dict(_LOGO["box"], x=_LOGO["box"]["x"] + 3_000_000)
    s["elements"].append(_image(moved, role="logo", elementId="logo"))


def _contrast(s: dict[str, Any]) -> None:
    _run(s, "list")["color"] = "E6E6E6"


def _bullet_count(s: dict[str, Any]) -> None:
    body = _element(s, "list")
    body["paragraphs"] = [copy.deepcopy(body["paragraphs"][0]) for _ in range(8)]


def _bullet_length(s: dict[str, Any]) -> None:
    _run(s, "list")["text"] = " ".join(["слово"] * 20)


def _table_size(s: dict[str, Any]) -> None:
    body = _element(s, "list")
    s["elements"].remove(body)
    s["elements"].append(
        {
            "kind": "table",
            "elementId": "table",
            "role": "table",
            "box": _BODY_BOX,
            "sourceShapeId": None,
            "headers": ["Метрика", "Q1", "Q2"],
            "rows": [["x", "1", "2"]] * 8,
        }
    )


def _chart_series(s: dict[str, Any]) -> None:
    _overlap(s)
    chart = _element(s, "chart")
    chart["series"] = [{"name": f"Серия {i}", "values": [1, 2]} for i in range(6)]


def _chart_labels(s: dict[str, Any]) -> None:
    _overlap(s)
    _element(s, "chart")["categories"] = ["Q1", " "]


def _slide_fill(s: dict[str, Any]) -> None:
    _element(s, "list")["box"]["cy"] = 400_000
    _element(s, "list")["paragraphs"] = _element(s, "list")["paragraphs"][:1]


def _empty_slide(s: dict[str, Any]) -> None:
    s["elements"] = [e for e in s["elements"] if e["role"] == "title"]


def _raster_slide(s: dict[str, Any]) -> None:
    whole = {"x": 0, "y": 0, "cx": _GRID["slideCx"], "cy": _GRID["slideCy"]}
    s["elements"] = [_image(whole)]


def _picture_covers_text(s: dict[str, Any]) -> None:
    whole = {"x": 0, "y": 0, "cx": _GRID["slideCx"], "cy": _GRID["slideCy"]}
    s["elements"].append(_image(whole, elementId="cover"))


def _duplicate_slide(s: dict[str, Any]) -> list[dict[str, Any]]:
    twin = copy.deepcopy(s)
    twin["slideId"], twin["index"] = "s2", 1
    return [twin]


def _placeholder_text(s: dict[str, Any]) -> None:
    pattern = deterministic_profile("default")["placeholder-text"]["forbiddenPatterns"][0]
    _run(s, "list")["text"] = f"{pattern} сюда"


def _template_leftover(s: dict[str, Any]) -> None:
    _run(s, "list")["text"] = "Итоги 2019 года"


def _empty_image_slot(s: dict[str, Any]) -> None:
    frame = {"x": _LEFT, "y": 1_828_800, "cx": 3_000_000, "cy": 2_000_000}
    s["elements"].append(
        {
            "kind": "decor",
            "elementId": "image-slot-9",
            "role": "image",
            "box": frame,
            "sourceShapeId": 9,
        }
    )


_VIOLATIONS: dict[str, Callable[[dict[str, Any]], list[dict[str, Any]] | None]] = {
    "slide-bounds": _slide_bounds,
    "text-clipped": _text_clipped,
    "overlap": _overlap,
    "text-overflow": _text_overflow,
    "word-break": _word_break,
    "grid-alignment": _grid_alignment,
    "safe-margins": _safe_margins,
    "image-aspect": _image_aspect,
    "font-usage": _font_usage,
    "type-scale": _type_scale,
    "palette": _palette,
    "template-layout": _template_layout,
    "protected-zones": _protected_zones,
    "contrast": _contrast,
    "bullet-count": _bullet_count,
    "bullet-length": _bullet_length,
    "table-size": _table_size,
    "chart-series": _chart_series,
    "chart-labels": _chart_labels,
    "slide-fill": _slide_fill,
    "empty-slide": _empty_slide,
    "raster-slide": _raster_slide,
    "picture-covers-text": _picture_covers_text,
    "duplicate-slide": _duplicate_slide,
    "placeholder-text": _placeholder_text,
    "template-leftover": _template_leftover,
    "empty-image-slot": _empty_image_slot,
}

_IDS = [check.id for check in DETERMINISTIC_CHECKS]
_MEDIA = {"ppt/media/photo.png": {"width": 1600, "height": 900}}


def test_every_registered_check_has_a_violating_case() -> None:
    assert set(_VIOLATIONS) == set(_IDS)


@pytest.mark.parametrize("check_id", _IDS)
def test_check_passes_a_clean_slide(check_id: str) -> None:
    assert check_id not in _fired(_clean_slide(), _MEDIA)


@pytest.mark.parametrize("check_id", _IDS)
def test_check_fires_on_a_slide_that_breaks_it(check_id: str) -> None:
    slide = _clean_slide()
    more = _VIOLATIONS[check_id](slide) or []
    assert check_id in _fired(slide, _MEDIA, *more)


def test_a_full_slide_picture_behind_text_does_not_cover_it() -> None:
    slide = _clean_slide()
    whole = {"x": 0, "y": 0, "cx": _GRID["slideCx"], "cy": _GRID["slideCy"]}
    slide["elements"].insert(0, _image(whole, elementId="backdrop"))
    assert "picture-covers-text" not in _fired(slide, _MEDIA)


def test_a_small_picture_in_front_of_text_is_left_in_front() -> None:
    slide = _clean_slide()
    slide["elements"].append(
        _image({"x": _LEFT, "y": 1_828_800, "cx": 400_000, "cy": 400_000}, elementId="badge")
    )
    assert "picture-covers-text" not in _fired(slide, _MEDIA)


def _sparse_slide() -> dict[str, Any]:
    """A tall body frame, as a template draws it, holding two short lines of small type."""
    slide = _clean_slide()
    body = _element(slide, "list")
    body["box"] = {**body["box"], "cy": 4_400_000}
    body["paragraphs"] = body["paragraphs"][:2]
    return slide


def test_slide_fill_measures_the_text_not_the_frame_around_it() -> None:
    assert "slide-fill" in _fired(_sparse_slide())
    # The same frame holding enough text is a full slide.
    assert "slide-fill" not in _fired(_clean_slide())


def test_the_cover_and_the_closing_slide_may_be_sparse() -> None:
    cover, middle, closing = _sparse_slide(), _sparse_slide(), _sparse_slide()
    for index, slide in enumerate((cover, middle, closing)):
        slide["slideId"], slide["index"] = f"s{index + 1}", index
    report = audit_deck(
        _request(cover, None, middle, closing), "default", deterministic_profile("default")
    )
    flagged = {f["target"]["slideId"] for f in report["findings"] if f["checkId"] == "slide-fill"}
    # Only the one between them is a content slide.
    assert flagged == {"s2"}


def test_slide_fill_does_not_count_an_empty_text_frame() -> None:
    slide = _sparse_slide()
    slide["elements"].append(
        _text("blank", "body", {"x": _LEFT, "y": 700_000, "cx": _WIDTH, "cy": 4_800_000}, "")
    )
    assert "slide-fill" in _fired(slide)


def test_a_picture_over_the_whole_slide_is_the_background_not_the_load() -> None:
    cover = _clean_slide()
    cover["elements"] = [
        _image(
            {"x": 0, "y": 0, "cx": _GRID["slideCx"], "cy": _GRID["slideCy"]},
            elementId="slide-5",
        ),
        _text("title", "title", _TITLE_BOX, "Итоги года", size=40),
        _text("sub", "subtitle", _BODY_BOX, "Отчёт для совета директоров", size=16),
    ]
    assert "slide-fill" not in _fired(cover, _MEDIA)
    # What lies on the picture still counts: a bare slide on it is a sparse one.
    cover["elements"][2] = _text("list", "bullet-list", _BODY_BOX, "Один пункт", size=16)
    assert "slide-fill" in _fired(cover, _MEDIA)


def test_a_picture_the_layout_draws_is_template_art_not_content() -> None:
    slide = _clean_slide()
    art = _image(
        {"x": _LEFT, "y": 1_900_000, "cx": _WIDTH // 2, "cy": 2_000_000}, elementId="layout-12"
    )
    slide["elements"].append(art)
    assert "overlap" not in _fired(slide, _MEDIA)
    # The same picture on the slide itself is the deck's own, and it lies over the text.
    art["elementId"] = "slide-12"
    assert "overlap" in _fired(slide, _MEDIA)


def test_a_slide_with_only_the_layouts_picture_is_empty() -> None:
    slide = _clean_slide()
    slide["elements"] = [
        _image({"x": 0, "y": 0, "cx": 4_000_000, "cy": 3_000_000}, elementId="layout-3"),
        _text("title", "title", _TITLE_BOX, "", size=40),
    ]
    assert "empty-slide" in _fired(slide, _MEDIA)
    slide["elements"][0]["elementId"] = "slide-3"
    assert "empty-slide" not in _fired(slide, _MEDIA)


def test_type_scale_reports_a_slide_once_and_fixes_every_block() -> None:
    slide = _clean_slide()
    _run(slide, "title")["sizePt"] = 47
    _run(slide, "list")["sizePt"] = 23
    report = audit_deck(_request(slide), "default", deterministic_profile("default"))
    found = [f for f in report["findings"] if f["checkId"] == "type-scale"]
    assert len(found) == 1
    ops = found[0]["proposedPatch"]["ops"]
    assert {op["elementId"] for op in ops} == {"title", "list"}


def test_two_slides_with_the_same_short_phrase_are_a_repeat() -> None:
    def thanks(slide_id: str, index: int) -> dict[str, Any]:
        slide = _clean_slide()
        slide["slideId"], slide["index"] = slide_id, index
        slide["elements"] = [_text("title", "title", _TITLE_BOX, "Спасибо за внимание", size=40)]
        return slide

    assert "duplicate-slide" in _fired(thanks("s1", 0), None, thanks("s2", 1))
    # A slide whose one word is all it says is a divider, and dividers may repeat.
    divider = thanks("s1", 0)
    divider["elements"][0]["paragraphs"][0]["runs"][0]["text"] = "Раздел 1"
    other = thanks("s2", 1)
    other["elements"][0]["paragraphs"][0]["runs"][0]["text"] = "Раздел 2"
    assert "duplicate-slide" not in _fired(divider, None, other)


def _torn_slide(size: float) -> dict[str, Any]:
    slide = _clean_slide()
    body = _element(slide, "list")
    body["box"] = {**body["box"], "cx": 2_800_000}
    body["paragraphs"] = body["paragraphs"][:1]
    run = _run(slide, "list")
    run["text"], run["sizePt"] = "Достопримечательностей", size
    return slide


def test_word_break_names_the_word_and_proposes_a_size_of_the_scale() -> None:
    report = audit_deck(_request(_torn_slide(24)), "default", deterministic_profile("default"))
    [found] = [f for f in report["findings"] if f["checkId"] == "word-break"]
    assert "«Достопримечательностей»" in found["detail"]
    assert found["target"]["elementId"] == "list"
    ops = found["proposedPatch"]["ops"]
    assert ops == [{"op": "set-font-size", "elementId": "list", "sizePt": 16.0}]


def test_word_break_asks_for_a_shorter_word_when_no_size_of_the_scale_helps() -> None:
    slide = _torn_slide(16)
    _run(slide, "list")["text"] = "Электроэнцефалографических"
    report = audit_deck(_request(slide), "default", deterministic_profile("default"))
    [found] = [f for f in report["findings"] if f["checkId"] == "word-break"]
    assert found["proposedPatch"] is None
    assert "заменить" in found["detail"]


def test_word_break_ignores_short_words_and_text_that_wraps_between_words() -> None:
    wraps = _torn_slide(16)
    _run(wraps, "list")["text"] = "Рост продаж за квартал и выводы для команды продаж"
    assert "word-break" not in _fired(wraps)
    short = _torn_slide(40)
    _run(short, "list")["text"] = "Итоги"
    assert "word-break" not in _fired(short)


def test_clean_deck_passes_with_a_full_score() -> None:
    report = audit_deck(
        _request(_clean_slide(), _MEDIA), "default", deterministic_profile("default")
    )
    assert report["passed"] is True
    assert report["score"] == 100
    assert report["findings"] == []
    assert {c["category"] for c in report["categories"]} == {
        "layout",
        "template",
        "density",
        "integrity",
    }


def test_a_major_finding_holds_the_deck_back() -> None:
    slide = _clean_slide()
    _text_clipped(slide)
    report = audit_deck(_request(slide), "default", deterministic_profile("default"))
    assert report["passed"] is False
    assert report["counts"]["blocker"] == 1
    layout = next(c for c in report["categories"] if c["category"] == "layout")
    assert layout["passed"] is False


def test_a_proposed_move_clears_the_finding_it_answers() -> None:
    slide = _clean_slide()
    _safe_margins(slide)
    report = audit_deck(_request(slide), "default", deterministic_profile("default"))
    finding = next(f for f in report["findings"] if f["checkId"] == "safe-margins")
    assert finding["fixability"] == "auto"
    op = finding["proposedPatch"]["ops"][0]
    _element(slide, op["elementId"])["box"] = op["box"]
    assert "safe-margins" not in _fired(slide)


def test_a_check_switched_off_in_the_profile_does_not_run() -> None:
    slide = _clean_slide()
    _palette(slide)
    report = audit_deck(_request(slide), "custom", {"palette": {"enabled": False}})
    assert all(f["checkId"] != "palette" for f in report["findings"])


def test_strict_profile_inherits_and_tightens_the_default() -> None:
    strict = deterministic_profile("strict")
    assert strict["bullet-count"]["maxBulletsPerSlide"] == 5
    assert strict["contrast"]["minContrastRatio"] == 7
    assert strict["table-size"]["maxRows"] == 7


def _leftovers(slide: dict[str, Any], **extra: Any) -> list[dict[str, Any]]:
    request = {**_request(slide, _MEDIA), **extra}
    report = audit_deck(request, "default", deterministic_profile("default"))
    return [f for f in report["findings"] if f["checkId"] == "template-leftover"]


def test_a_past_year_is_stale_unless_the_content_names_it() -> None:
    slide = _clean_slide()
    _run(slide, "title")["text"] = "Зелёный офис 2024"
    assert [f["severity"] for f in _leftovers(slide, today="2026-09-29")] == ["major"]
    assert _leftovers(slide, today="2026-09-29", knownYears=[2024]) == []
    assert _leftovers(slide, today="2024-05-01") == []


def test_the_sample_left_in_a_slot_is_flagged_and_new_copy_is_not() -> None:
    slide = _clean_slide()
    samples = {"s1": {"list": "Обычно вы сначала найдёте вопрос", "title": "01"}}
    assert _leftovers(slide, slotSamples=samples) == []
    _run(slide, "list")["text"] = "Обычно вы сначала найдёте вопрос"
    _element(slide, "list")["paragraphs"] = _element(slide, "list")["paragraphs"][:1]
    found = _leftovers(slide, slotSamples=samples)
    assert [(f["target"]["elementId"], f["severity"]) for f in found] == [("list", "minor")]
