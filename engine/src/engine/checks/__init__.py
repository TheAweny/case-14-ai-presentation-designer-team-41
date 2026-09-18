"""Checks layer: the deterministic half of the audit.

Everything measurable lives here — geometry, contrast, counts, fonts, leftover placeholder text.
Judgements that need to read meaning are contextual checks and run on the TypeScript side.
"""

from engine.checks.registry import DETERMINISTIC_CHECKS, CheckDefinition, check_by_id
from engine.contracts.provisional import AuditFinding, SlideIR, TemplateProfile

__all__ = [
    "DETERMINISTIC_CHECKS",
    "CheckDefinition",
    "check_by_id",
    "run_deterministic_checks",
]


def run_deterministic_checks(
    slides: list[SlideIR],
    profile: TemplateProfile,
    enabled_checks: dict[str, dict[str, object]],
) -> list[AuditFinding]:
    """Run the enabled deterministic checks over a deck.

    Args:
        slides: Slide IR of the deck under audit.
        profile: Template profile the deck was built from.
        enabled_checks: Check ids mapped to their thresholds, taken from the audit profile.

    Returns:
        One finding per violation, in slide order.
    """
    raise NotImplementedError
