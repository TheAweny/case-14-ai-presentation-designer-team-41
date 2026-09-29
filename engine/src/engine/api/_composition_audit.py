"""SlideIR of a deck exported from template compositions, so the audit can measure it.

A composition deck is a set of the template's own slides with new text in their slots. Only the
slots are content; everything else on a slide is the template's design and is passed on as
decoration, which the audit uses as backdrop but never judges.
"""

from typing import Any


def _paragraphs(shape: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "level": p.get("level", 0),
            "runs": [
                {
                    "text": r.get("text", ""),
                    "font": r.get("font", ""),
                    "sizePt": r.get("sizePt"),
                    "bold": r.get("bold"),
                    "italic": r.get("italic"),
                    "color": r.get("color", ""),
                }
                for r in p.get("runs", [])
            ],
            "lineSpacing": p.get("lineSpacing"),
        }
        for p in shape.get("paragraphs", [])
    ]


def composition_slides(
    ir: dict[str, Any], request: list[dict[str, Any]], patterns: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    """One SlideIR per exported slide: slots as title or body, the visual as a table or chart."""
    slides = []
    for index, (slide, composed) in enumerate(zip(ir["slides"], request, strict=False)):
        pattern = patterns.get(composed["patternId"], {"slots": []})
        roles = {str(s["slotId"]): s["role"] for s in pattern["slots"]}
        # An image slot still in the written file got no picture: a frame left for one. A sample
        # photo left in place is a picture, not an empty frame.
        frames = {
            str(s["slotId"]) for s in pattern.get("imageSlots") or [] if s.get("kind") != "photo"
        }
        visual = composed.get("visual") or None
        elements: list[dict[str, Any]] = []
        for shape in slide["shapes"]:
            box = shape.get("box")
            if box is None or box["cx"] <= 0 or box["cy"] <= 0:
                continue
            slot = str(shape["shapeId"])
            base = {"box": box, "sourceShapeId": shape["shapeId"]}
            if (
                slot in roles
                and _paragraphs(shape)
                and any(r["text"].strip() for p in _paragraphs(shape) for r in p["runs"])
            ):
                elements.append(
                    {
                        **base,
                        "kind": "text",
                        "elementId": f"slot-{slot}",
                        "role": "title" if roles[slot] == "title" else "body",
                        "paragraphs": _paragraphs(shape),
                        "overflow": None,
                    }
                )
            elif visual and shape["kind"] in {"table", "chart"}:
                element = {
                    **base,
                    "elementId": f"visual-{visual['slotId']}",
                    "role": visual["kind"],
                }
                if visual["kind"] == "table":
                    elements.append(
                        {
                            **element,
                            "kind": "table",
                            "headers": visual["headers"],
                            "rows": visual["rows"],
                        }
                    )
                else:
                    elements.append(
                        {
                            **element,
                            "kind": "chart",
                            "chartType": visual["chartType"],
                            "categories": visual["categories"],
                            "series": visual["series"],
                            "xTitle": visual.get("xTitle", ""),
                            "yTitle": visual.get("yTitle", ""),
                        }
                    )
            elif slot in frames:
                elements.append(
                    {**base, "kind": "decor", "elementId": f"image-slot-{slot}", "role": "image"}
                )
            else:
                elements.append(
                    {**base, "kind": "decor", "elementId": f"template-{slot}", "role": "decoration"}
                )
        slides.append(
            {
                "schemaVersion": 1,
                "slideId": f"s{index + 1}",
                "variant": "balanced",
                "index": index,
                "patternId": composed["patternId"],
                "slideCx": ir["slideCx"],
                "slideCy": ir["slideCy"],
                "elements": elements,
            }
        )
    return slides
