"""Conservative room estimates and structural evidence from the existing SlideIR reader.

Character counts are planning hints. Font metrics and the exported render decide actual fit.
No function in this module assigns semantic relationships to shapes.
"""

import math
import re
from typing import Any

_PT = 12700


def intersection(a: dict[str, Any], b: dict[str, Any]) -> dict[str, int] | None:
    x, y = max(a["x"], b["x"]), max(a["y"], b["y"])
    right = min(a["x"] + a["cx"], b["x"] + b["cx"])
    bottom = min(a["y"] + a["cy"], b["y"] + b["cy"])
    return {"x": x, "y": y, "cx": right - x, "cy": bottom - y} if right > x and bottom > y else None


def contains(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return (
        a["x"] <= b["x"]
        and a["y"] <= b["y"]
        and a["x"] + a["cx"] >= b["x"] + b["cx"]
        and a["y"] + a["cy"] >= b["y"] + b["cy"]
    )


def resolved_metrics(
    element: dict[str, Any],
    fallback: dict[str, Any],
    *,
    font_scale: float = 1.0,
    spacing_reduction: float = 0.0,
) -> dict[str, Any]:
    """Use resolved paragraph styles, including inherited bullets and all list levels."""
    paragraphs = element.get("paragraphs") or []
    runs = [r for p in paragraphs for r in p["runs"]]
    size = max(
        ((r.get("sizePt") or fallback["fontSize"] * font_scale) / font_scale for r in runs),
        default=fallback["fontSize"],
    )
    # The existing reader expresses fixed line spacing relative to 1.2 em.
    spacing = (
        max((p.get("lineSpacing") or 1.0 for p in paragraphs), default=1.0) + spacing_reduction
    ) * 1.2
    indent = max(
        (max(0, p.get("marginEmu", 0) + max(0, p.get("indentEmu", 0))) for p in paragraphs),
        default=0,
    )
    insets = element.get("textInsets") or {}
    box = element["box"]
    return {
        **fallback,
        "font": next((r["font"] for r in runs if r.get("font")), fallback["font"]),
        "fontSize": size,
        "lineSpacing": spacing,
        "spaceBeforePt": max((p.get("spaceBeforePt", 0) for p in paragraphs), default=0),
        "spaceAfterPt": max((p.get("spaceAfterPt", 0) for p in paragraphs), default=0),
        "textWidthPt": max(
            1.0, (box["cx"] - insets.get("l", 0) - insets.get("r", 0) - indent) / _PT
        ),
        "textHeightPt": max(1.0, (box["cy"] - insets.get("t", 0) - insets.get("b", 0)) / _PT),
    }


def estimate_room(metrics: dict[str, Any], paragraph_count: int = 1) -> tuple[int, int]:
    size = metrics["fontSize"]
    line_height = max(size, size * metrics["lineSpacing"])
    spacing = (metrics.get("spaceBeforePt", 0) + metrics.get("spaceAfterPt", 0)) * paragraph_count
    lines = max(1, math.floor(max(0, metrics["textHeightPt"] - spacing) / line_height))
    chars = max(1, math.floor(metrics["textWidthPt"] / (size * 0.59))) * lines
    return max(1, min(chars, 750)), lines


def safe_room(
    element: dict[str, Any],
    metrics: dict[str, Any],
    elements: list[dict[str, Any]],
    image_ids: set[str],
) -> tuple[dict[str, Any], list[str], bool]:
    """Keep an origin-anchored rectangle clear of partial decorative art and other copy.

    Full backdrops and replaceable photos are intentional backgrounds, audited separately.
    A rotated box or an obstacle covering the text origin cannot be certified by this estimate.
    """
    box = element["box"]
    safe = dict(metrics)
    obstacles: list[str] = []
    unknown = bool(element.get("rotation") or element.get("flipH") or element.get("flipV"))
    for other in elements:
        if other is element or (
            other.get("sourceShapeId") == element.get("sourceShapeId")
            and other.get("sourcePart") == element.get("sourcePart")
        ):
            continue
        target = other["box"]
        overlap = intersection(box, target)
        if other.get("opacity", 1) == 0:
            continue
        if overlap is None or (
            other["kind"] == "decor" and not other.get("fill") and not other.get("geometry")
        ):
            continue
        if other["kind"] == "image" and str(other.get("sourceShapeId")) in image_ids:
            continue
        if not other.get("paragraphs") and other["kind"] != "text" and contains(target, box):
            continue
        obstacles.append(other["elementId"])
        if other.get("rotation"):
            unknown = True
            continue
        # Insets/indent have already been subtracted; retain them at the new far edge too.
        width = min(
            safe["textWidthPt"], metrics["textWidthPt"] - (box["x"] + box["cx"] - target["x"]) / _PT
        )
        height = min(
            safe["textHeightPt"],
            metrics["textHeightPt"] - (box["y"] + box["cy"] - target["y"]) / _PT,
        )
        candidates = []
        if width > 0:
            candidates.append((width * safe["textHeightPt"], "textWidthPt", width))
        if height > 0:
            candidates.append((height * safe["textWidthPt"], "textHeightPt", height))
        if not candidates:
            unknown = True
            continue
        _, dimension, value = max(candidates)
        safe[dimension] = min(safe[dimension], value)
    return safe, obstacles, unknown


def composition_evidence(slide: dict[str, Any], pattern: dict[str, Any]) -> dict[str, Any]:
    """Proposed transport fields; until Zod adoption these remain a Python-only preparation API.

    Group IDs prove XML containment only. Number-shaped copy is merely a candidate for decor.
    """
    elements = slide["elements"]
    slots = {s["slotId"] for s in pattern["slots"]}
    text = [
        e
        for e in elements
        if e.get("paragraphs") and not e.get("sourcePart") and str(e.get("sourceShapeId")) in slots
    ]
    structures = []
    capacities = []
    slot_map = {s["slotId"]: s for s in pattern["slots"]}
    for element in text:
        paragraphs = element["paragraphs"]
        sample = "\n".join("".join(r["text"] for r in p["runs"]) for p in paragraphs).strip()
        structures.append(
            {
                "slotId": str(element["sourceShapeId"]),
                "groupIds": element.get("groupIds", []),
                "paragraphs": paragraphs,
                "listEvidence": "native-list"
                if any(p.get("bullet") for p in paragraphs)
                else "none",
                "numberingCandidate": bool(re.fullmatch(r"\d{1,3}[.)]?", sample)),
                "semanticRole": "unknown",
            }
        )
        slot = slot_map[str(element["sourceShapeId"])]
        physical_metrics = resolved_metrics(element, slot)
        # Slots already describe the nominal font used by replacement export (no shrinking).
        for key in ("fontSize", "lineSpacing", "spaceBeforePt", "spaceAfterPt"):
            physical_metrics[key] = slot[key]
        physical_chars, physical_lines = estimate_room(physical_metrics, len(paragraphs))
        capacities.append(
            {
                "slotId": slot["slotId"],
                "physicalCharsEstimate": physical_chars,
                "physicalLinesEstimate": physical_lines,
                "safeCharsEstimate": slot["maxChars"],
                "safeTextWidthPt": slot["textWidthPt"],
                "safeTextHeightPt": slot["textHeightPt"],
                "sampleParagraphCount": len(paragraphs),
                "basis": slot["capacity"]["basis"],
                "fitVerified": False,
            }
        )
    constraints = []
    for image in pattern.get("imageSlots", []):
        placed = next(
            (
                e
                for e in elements
                if not e.get("sourcePart") and str(e.get("sourceShapeId")) == image["slotId"]
            ),
            None,
        )
        for element in text:
            overlap = intersection(image["box"], element["box"])
            if overlap is None:
                continue
            known_order = placed is not None and elements.index(placed) < elements.index(element)
            protections = [
                {"elementId": e["elementId"], "fill": e.get("fill"), "opacity": e.get("opacity", 1)}
                for e in elements[
                    (elements.index(placed) + 1 if placed else 0) : elements.index(element)
                ]
                if e["kind"] == "decor"
                and e.get("fill")
                and contains(e["box"], overlap)
                and not e.get("rotation")
                and e.get("shape") == "rect"
            ]
            constraints.append(
                {
                    "imageSlotId": image["slotId"],
                    "textSlotId": str(element["sourceShapeId"]),
                    "region": overlap,
                    "regionInImage": {
                        "x": (overlap["x"] - image["box"]["x"]) / image["box"]["cx"],
                        "y": (overlap["y"] - image["box"]["y"]) / image["box"]["cy"],
                        "width": overlap["cx"] / image["box"]["cx"],
                        "height": overlap["cy"] / image["box"]["cy"],
                    },
                    "textColors": sorted(
                        {
                            r["color"]
                            for p in element["paragraphs"]
                            for r in p["runs"]
                            if r.get("color")
                        }
                    ),
                    "textAboveImage": known_order,
                    "state": "known"
                    if known_order
                    and placed is not None
                    and not element.get("rotation")
                    and not element.get("flipH")
                    and not element.get("flipV")
                    and not placed.get("rotation")
                    and not placed.get("flipH")
                    and not placed.get("flipV")
                    else "unknown",
                    "protection": protections,
                    "crop": placed.get("crop") if placed else None,
                    "fit": placed.get("fit") if placed else None,
                    "readability": "unknown",
                }
            )
    return {"structures": structures, "capacities": capacities, "imageConstraints": constraints}


def _clamp_share(value: float) -> float:
    return min(1.0, max(0.0, float(value)))


def _hex_color(color: object) -> str | None:
    text = str(color or "").removeprefix("#").upper()
    if len(text) == 6 and all(char in "0123456789ABCDEF" for char in text):
        return text
    return None


def _frame_crop(crop: object) -> dict[str, float] | None:
    if not isinstance(crop, dict):
        return None
    try:
        parsed = {key: float(crop[key]) for key in ("l", "t", "r", "b")}
    except (KeyError, TypeError, ValueError):
        return None
    if any(parsed[key] < 0 or parsed[key] >= 1 for key in parsed):
        return None
    if parsed["l"] + parsed["r"] >= 1 or parsed["t"] + parsed["b"] >= 1:
        return None
    if not any(parsed.values()):
        return None
    return {key: round(parsed[key], 3) for key in ("l", "t", "r", "b")}


def frame_for_image(constraints: list[dict[str, Any]], crop: object) -> dict[str, Any]:
    """One picture's text overlaps, crop and protection, normalised to the frame."""
    regions = []
    colors: set[str] = set()
    unknown = _frame_crop(crop) is None and isinstance(crop, dict) and any(crop.values())
    for constraint in constraints:
        # Text definitively behind the picture is covered by it; an unknown order stays in frame.
        if constraint.get("state") == "known" and not constraint.get("textAboveImage"):
            continue
        raw = constraint.get("regionInImage") or {}
        try:
            x, y = _clamp_share(raw["x"]), _clamp_share(raw["y"])
            width = min(_clamp_share(raw["width"]), 1 - x)
            height = min(_clamp_share(raw["height"]), 1 - y)
        except (KeyError, TypeError, ValueError):
            unknown = True
            continue
        if width <= 0.001 or height <= 0.001:
            continue
        if constraint.get("state") != "known":
            protection = "unknown"
            unknown = True
        elif constraint.get("protection"):
            protection = "solid"
        else:
            protection = "none"
        for color in constraint.get("textColors") or []:
            parsed = _hex_color(color)
            if parsed:
                colors.add(parsed)
            else:
                unknown = True
        regions.append(
            {
                "x": round(x, 3),
                "y": round(y, 3),
                "width": round(width, 3),
                "height": round(height, 3),
                "protection": protection,
            }
        )
    regions.sort(
        key=lambda region: (region["y"], region["x"], region["width"], region["protection"])
    )
    return {
        "textRegions": regions,
        "textColors": sorted(colors),
        "crop": _frame_crop(crop),
        "state": "unknown" if unknown else "known",
    }


def attach_image_frames(pattern: dict[str, Any], slide: dict[str, Any]) -> None:
    """Stamp each image slot with the frame the illustrator and the checkpoint key must share."""
    evidence = composition_evidence(slide, pattern)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for constraint in evidence["imageConstraints"]:
        grouped.setdefault(constraint["imageSlotId"], []).append(constraint)
    elements = slide.get("elements") or []
    for image in pattern.get("imageSlots") or []:
        placed = next(
            (
                element
                for element in elements
                if not element.get("sourcePart")
                and str(element.get("sourceShapeId")) == image["slotId"]
            ),
            None,
        )
        crop = placed.get("crop") if placed else None
        if crop is None and grouped.get(image["slotId"]):
            crop = grouped[image["slotId"]][0].get("crop")
        image["frame"] = frame_for_image(grouped.get(image["slotId"], []), crop)
