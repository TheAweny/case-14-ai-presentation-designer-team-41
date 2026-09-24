"""Layout layer: places a deck plan onto slides, deterministically.

Given a plan and a template profile the layer produces the slide IR. It never rewrites text:
when a block does not fit it reports an overflow signal, and the agent on the TypeScript side
decides how to shorten the copy.
"""

from typing import Any

from engine.contracts import DeckPlan, SlideIR

__all__ = ["build_slide_ir"]


def build_slide_ir(plan: DeckPlan, design_system: dict[str, Any]) -> list[SlideIR]:
    """Lay the deck plan out against the template profile.

    Args:
        plan: Deck plan produced once per run and reused by every layout variant.
        design_system: Validated design system extracted from the template.

    Returns:
        One IR entry per slide, each carrying its overflow signals.
    """
    grid = design_system["grid"]
    title_style = _style(design_system, "title")
    body_style = _style(design_system, "body")
    width = grid["slideCx"] - grid["marginLeft"] - grid["marginRight"]
    title_height = max(grid["baseline"] * 3, int(grid["slideCy"] * 0.15))
    body_top = grid["marginTop"] + title_height + grid["baseline"]
    body_height = grid["slideCy"] - body_top - grid["marginBottom"]
    slides: list[SlideIR] = []
    for index, slide in enumerate(plan.slides):
        body = next((block.text for block in slide.blocks if block.kind == "paragraph"), "")
        slides.append(
            SlideIR.model_validate(
                {
                    "schemaVersion": 1,
                    "slideId": slide.slideId,
                    "variant": "balanced",
                    "index": index,
                    "patternId": "generated-text",
                    "slideCx": grid["slideCx"],
                    "slideCy": grid["slideCy"],
                    "elements": [
                        {
                            "elementId": f"title-{slide.slideId}",
                            "kind": "text",
                            "role": "title",
                            "sourceShapeId": None,
                            "box": {
                                "x": grid["marginLeft"],
                                "y": grid["marginTop"],
                                "cx": width,
                                "cy": title_height,
                            },
                            "paragraphs": [_paragraph(slide.headline, title_style)],
                            "overflow": None,
                        },
                        {
                            "elementId": f"body-{slide.slideId}",
                            "kind": "text",
                            "role": "body",
                            "sourceShapeId": None,
                            "box": {
                                "x": grid["marginLeft"],
                                "y": body_top,
                                "cx": width,
                                "cy": body_height,
                            },
                            "paragraphs": [_paragraph(body, body_style)],
                            "overflow": None,
                        },
                    ],
                }
            )
        )
    return slides


def _style(design_system: dict[str, Any], role: str) -> dict[str, Any]:
    return next(style for style in design_system["typeScale"] if style["role"] == role)


def _paragraph(text: str, style: dict[str, Any]) -> dict[str, Any]:
    return {
        "level": 0,
        "lineSpacing": style["lineSpacing"],
        "runs": [
            {
                "text": text,
                "font": style["font"],
                "sizePt": style["sizePt"],
                "bold": style["bold"],
                "italic": style["italic"],
                "color": "",
            }
        ],
    }
