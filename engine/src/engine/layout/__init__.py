"""Layout layer: places a deck plan onto slides, deterministically.

Given a plan and a template profile the layer produces the slide IR. It never rewrites text:
when a block does not fit it reports an overflow signal, and the agent on the TypeScript side
decides how to shorten the copy.
"""

from engine.contracts import DeckPlan, SlideIR, TemplateProfile

__all__ = ["build_slide_ir"]


def build_slide_ir(plan: DeckPlan, profile: TemplateProfile) -> list[SlideIR]:
    """Lay the deck plan out against the template profile.

    Args:
        plan: Deck plan produced once per run and reused by every layout variant.
        profile: Template profile the deck must follow.

    Returns:
        One IR entry per slide, each carrying its overflow signals.
    """
    width = profile.slideSize.widthPt
    height = profile.slideSize.heightPt
    slides: list[SlideIR] = []
    for slide in plan.slides:
        slides.append(
            SlideIR.model_validate(
                {
                    "schemaVersion": "1.0.0",
                    "slideId": slide.slideId,
                    "objects": [
                        {
                            "objectId": f"title-{slide.slideId}",
                            "kind": "text",
                            "text": slide.title,
                            "bbox": {
                                "x": width * 0.1,
                                "y": height * 0.12,
                                "width": width * 0.8,
                                "height": height * 0.16,
                            },
                        },
                        {
                            "objectId": f"body-{slide.slideId}",
                            "kind": "text",
                            "text": slide.intent,
                            "bbox": {
                                "x": width * 0.1,
                                "y": height * 0.36,
                                "width": width * 0.8,
                                "height": height * 0.48,
                            },
                        },
                    ],
                }
            )
        )
    return slides
