"""Layout layer: places a deck plan onto slides, deterministically.

Given a plan and a template profile the layer produces the slide IR. It never rewrites text:
when a block does not fit it reports an overflow signal, and the agent on the TypeScript side
decides how to shorten the copy.
"""

from engine.contracts import DeckPlan, SlideIR
from engine.contracts.provisional import TemplateProfile

__all__ = ["build_slide_ir"]


def build_slide_ir(plan: DeckPlan, profile: TemplateProfile) -> list[SlideIR]:
    """Lay the deck plan out against the template profile.

    Args:
        plan: Deck plan produced once per run and reused by every layout variant.
        profile: Template profile the deck must follow.

    Returns:
        One IR entry per slide, each carrying its overflow signals.
    """
    raise NotImplementedError
