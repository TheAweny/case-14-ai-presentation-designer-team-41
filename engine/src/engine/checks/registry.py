"""Registry of the deterministic audit checks.

`docs/AUDIT.md` is generated from this registry together with the contextual registry on the
TypeScript side, so the documentation cannot drift away from the code.
"""

from dataclasses import dataclass

__all__ = ["DETERMINISTIC_CHECKS", "CheckDefinition", "check_by_id"]


@dataclass(frozen=True, slots=True)
class CheckDefinition:
    """One deterministic check: what it looks at and why it matters."""

    id: str
    title: str
    description: str
    severity: str


DETERMINISTIC_CHECKS: tuple[CheckDefinition, ...] = (
    CheckDefinition(
        id="text-overflow",
        title="Text stays inside its box",
        description=(
            "Measures every text frame against the box the layout gave it and reports the blocks "
            "that do not fit. The finding carries the overflow amount so an agent can shorten "
            "the copy."
        ),
        severity="error",
    ),
    CheckDefinition(
        id="bullet-count",
        title="Bullet lists stay readable",
        description=(
            "Counts bullets per slide and lines per bullet against the thresholds of the audit "
            "profile."
        ),
        severity="warning",
    ),
    CheckDefinition(
        id="table-size",
        title="Tables fit the slide",
        description="Checks rows and columns against the limits of the audit profile.",
        severity="warning",
    ),
    CheckDefinition(
        id="contrast",
        title="Text contrasts with its background",
        description=(
            "Computes the contrast ratio between each text run and the surface behind it, using "
            "the colors of the template profile."
        ),
        severity="error",
    ),
    CheckDefinition(
        id="safe-margins",
        title="Content respects the template margins",
        description=(
            "Verifies that no shape crosses the safe area derived from the template's own grid."
        ),
        severity="error",
    ),
    CheckDefinition(
        id="font-usage",
        title="Fonts come from the template",
        description=(
            "Checks that every font used on a slide belongs to the template profile and that the "
            "number of distinct fonts stays within the profile limit."
        ),
        severity="error",
    ),
    CheckDefinition(
        id="placeholder-text",
        title="No placeholder text is left",
        description=(
            "Scans the deck for filler strings that must never reach a user, such as 'lorem "
            "ipsum' or an unfilled prompt to insert text."
        ),
        severity="error",
    ),
)


def check_by_id(check_id: str) -> CheckDefinition:
    """Return the definition of a deterministic check.

    Args:
        check_id: Identifier used in `configs/audit.yaml`.

    Raises:
        KeyError: If no check with that id is registered.
    """
    for check in DETERMINISTIC_CHECKS:
        if check.id == check_id:
            return check
    raise KeyError(check_id)
