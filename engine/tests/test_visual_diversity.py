"""Structural signatures. Colour, type and a nudge are not a second design."""

from __future__ import annotations

from engine.visuals import build_visual, compare_subjects, contact_sheet_svg
from visual_samples import kpi_block, request_for


def _slide_elements(variant: str) -> list[dict]:
    return build_visual(request_for(kpi_block(), variant))["elements"]


def _recolor(elements: list[dict]) -> list[dict]:
    changed = []
    for element in elements:
        copy = {**element, "elementId": f"copy-{element['elementId']}"}
        if copy["kind"] == "text":
            paragraphs = []
            for paragraph in copy["paragraphs"]:
                runs = [
                    {**run, "font": "Other Face", "color": "FF00AA", "sizePt": 9}
                    for run in paragraph["runs"]
                ]
                paragraphs.append({**paragraph, "runs": runs})
            copy = {**copy, "paragraphs": paragraphs}
        changed.append(copy)
    return changed


def _shift(elements: list[dict], dx: int, dy: int) -> list[dict]:
    shifted = []
    for element in elements:
        box = element["box"]
        shifted.append({**element, "box": {**box, "x": box["x"] + dx, "y": box["y"] + dy}})
    return shifted


def _decorate(elements: list[dict]) -> list[dict]:
    noise = {
        "kind": "decor",
        "elementId": "noise",
        "role": "decoration",
        "box": {"x": 100, "y": 100, "cx": 400_000, "cy": 80_000},
        "sourceShapeId": None,
        "shape": "rect",
        "fill": "accent",
    }
    return [*elements, noise]


def test_cosmetic_controls_collapse_and_a_real_variant_does_not() -> None:
    dense, balanced, airy = (_slide_elements(name) for name in ("dense", "balanced", "airy"))
    subjects = [
        {"id": "dense", "role": "variant", "elements": dense},
        {"id": "balanced", "role": "variant", "elements": balanced},
        {"id": "airy", "role": "variant", "elements": airy},
        {"id": "recolored", "role": "control", "like": "balanced", "elements": _recolor(balanced)},
        {
            "id": "nudged",
            "role": "control",
            "like": "balanced",
            "elements": _shift(balanced, 3000, 2000),
        },
        {"id": "noisy", "role": "control", "like": "balanced", "elements": _decorate(balanced)},
    ]
    passed = compare_subjects(subjects)
    assert passed["variantsDistinct"] is True
    assert passed["accepted"] is True
    assert all(item["collapsed"] for item in passed["controls"])

    impostor = [
        *subjects,
        {"id": "impostor", "role": "control", "like": "balanced", "elements": dense},
    ]
    failed = compare_subjects(impostor)
    assert failed["accepted"] is False
    assert (
        next(item for item in failed["controls"] if item["id"] == "impostor")["collapsed"] is False
    )


def test_contact_sheet_carries_three_digests() -> None:
    panels = []
    for name in ("dense", "balanced", "airy"):
        built = build_visual(request_for(kpi_block(), name))
        panels.append(
            {
                "id": name,
                "title": name,
                "digest": built["signature"]["digest"],
                "elements": built["elements"],
            }
        )
    svg = contact_sheet_svg(panels)
    assert svg.count("data-panel=") == 3
    assert len({panel["digest"] for panel in panels}) == 3
    for panel in panels:
        assert panel["digest"] in svg
    target = (
        __import__("pathlib").Path(__file__).parent / "fixtures" / "visuals" / "contact-sheet.svg"
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        target.write_text(svg)
    assert target.read_text(encoding="utf-8") == svg
