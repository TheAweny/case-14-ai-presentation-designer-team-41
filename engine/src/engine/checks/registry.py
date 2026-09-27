"""Registry of the deterministic audit checks.

`docs/AUDIT.md` is generated from this registry together with the contextual registry on the
TypeScript side, so the documentation cannot drift away from the code.

Every threshold a check reads has its default here, and `configs/audit.yaml` overrides it per
profile. The defaults are the limits of the case requirements, so a request that names no profile
is judged by the rules the jury reads.
"""

from dataclasses import dataclass, field
from typing import Any

__all__ = ["CATEGORIES", "DETERMINISTIC_CHECKS", "CheckDefinition", "check_by_id"]

#: Requirement groups, in the order the report lists them.
CATEGORIES: tuple[str, ...] = ("layout", "template", "density", "content")


@dataclass(frozen=True, slots=True)
class CheckDefinition:
    """One deterministic check: what it looks at, why it matters and its default thresholds."""

    id: str
    category: str
    title: str
    description: str
    severity: str
    defaults: dict[str, Any] = field(default_factory=dict[str, Any])


DETERMINISTIC_CHECKS: tuple[CheckDefinition, ...] = (
    CheckDefinition(
        id="slide-bounds",
        category="layout",
        title="Elements stay on the slide",
        description=(
            "Reports any picture, table, chart or shape whose box leaves the slide. Template "
            "decoration that bleeds off the edge on purpose is left alone."
        ),
        severity="major",
        defaults={"toleranceShare": 0.002},
    ),
    CheckDefinition(
        id="text-clipped",
        category="layout",
        title="Text is not cut by the slide edge",
        description=(
            "Reports text whose box runs past the edge of the slide, where part of it would not "
            "be shown or printed."
        ),
        severity="blocker",
        defaults={"toleranceShare": 0.002},
    ),
    CheckDefinition(
        id="overlap",
        category="layout",
        title="Blocks do not overlap",
        description=(
            "Intersects the boxes of every two content elements on a slide and reports pairs "
            "that cover a noticeable part of each other. Text inside a shape and members of one "
            "group are not pairs."
        ),
        severity="major",
        defaults={"minOverlapShare": 0.05},
    ),
    CheckDefinition(
        id="text-overflow",
        category="layout",
        title="Text stays inside its box",
        description=(
            "Uses the overflow the layout reported, or estimates the lines the text needs at its "
            "size and compares them with the height of the box. The finding proposes a smaller "
            "size from the template scale when one fits."
        ),
        severity="major",
        defaults={"charWidthEm": 0.55, "lineHeight": 1.2, "slack": 1.05, "minSizePt": 10},
    ),
    CheckDefinition(
        id="grid-alignment",
        category="layout",
        title="Blocks sit on the layout guides",
        description=(
            "Checks that the left or right edge of every content block, or its centre, falls on a "
            "guide of the template: a margin, a column edge or a slot of the pattern the slide "
            "was built on."
        ),
        severity="minor",
        defaults={"toleranceShare": 0.006},
    ),
    CheckDefinition(
        id="safe-margins",
        category="layout",
        title="Content respects the template margins",
        description=(
            "Verifies that no content block crosses into the margins the template keeps free "
            "around its content area. Full-bleed pictures and template furniture are exempt."
        ),
        severity="major",
        defaults={"toleranceShare": 0.004, "minMarginPt": 18},
    ),
    CheckDefinition(
        id="image-aspect",
        category="layout",
        title="Pictures keep their proportions",
        description=(
            "Compares the proportions of the visible part of each picture with the proportions "
            "of its box and reports pictures that would be stretched or squeezed."
        ),
        severity="major",
        defaults={"maxDistortion": 0.02},
    ),
    CheckDefinition(
        id="font-usage",
        category="template",
        title="Fonts come from the template",
        description=(
            "Checks that every typeface on a slide belongs to the template and that a slide sets "
            "no more distinct typefaces than the profile allows."
        ),
        severity="major",
        defaults={"maxDistinctFonts": 2},
    ),
    CheckDefinition(
        id="type-scale",
        category="template",
        title="Sizes come from the type scale",
        description="Checks every stated text size against the sizes of the template type scale.",
        severity="minor",
        defaults={"tolerancePt": 0.5},
    ),
    CheckDefinition(
        id="palette",
        category="template",
        title="Colours come from the palette",
        description=(
            "Checks every colour stated as a literal value, on text, fills, outlines, tables and "
            "backgrounds, against the palette and surfaces of the template."
        ),
        severity="minor",
        defaults={"maxChannelDelta": 10},
    ),
    CheckDefinition(
        id="template-layout",
        category="template",
        title="Slides are built on template layouts",
        description=(
            "Checks that the pattern each slide names exists in the pattern catalogue of the "
            "template it claims to follow."
        ),
        severity="major",
    ),
    CheckDefinition(
        id="protected-zones",
        category="template",
        title="Logo and footer stay in place",
        description=(
            "Compares logos, footers and page numbers with the zones the template reserves for "
            "them, and reports content that covers a zone the slide or most of the template uses."
        ),
        severity="major",
        defaults={"toleranceShare": 0.01, "minZoneConfidence": 0.5},
    ),
    CheckDefinition(
        id="contrast",
        category="template",
        title="Text contrasts with its background",
        description=(
            "Computes the WCAG contrast ratio between each text and the fill painted behind it, "
            "using the colours of the template."
        ),
        severity="major",
        defaults={"minContrastRatio": 4.5},
    ),
    CheckDefinition(
        id="bullet-count",
        category="density",
        title="Bullet lists stay short",
        description="Counts the bullets of each slide against the limit of the audit profile.",
        severity="major",
        defaults={"maxBulletsPerSlide": 6},
    ),
    CheckDefinition(
        id="bullet-length",
        category="density",
        title="Bullets stay brief",
        description="Counts the words of each bullet against the limit of the audit profile.",
        severity="minor",
        defaults={"maxWordsPerBullet": 15},
    ),
    CheckDefinition(
        id="table-size",
        category="density",
        title="Tables fit the slide",
        description="Checks body rows and columns of each table against the profile limits.",
        severity="major",
        defaults={"maxRows": 7, "maxColumns": 5},
    ),
    CheckDefinition(
        id="chart-series",
        category="density",
        title="Charts stay readable",
        description="Counts the series of each chart against the limit of the audit profile.",
        severity="major",
        defaults={"maxSeries": 5},
    ),
    CheckDefinition(
        id="chart-labels",
        category="density",
        title="Charts are labelled",
        description=(
            "Reports charts with blank category labels, and charts of several series where a "
            "series has no name for the legend."
        ),
        severity="minor",
    ),
    CheckDefinition(
        id="slide-fill",
        category="density",
        title="Slides are neither empty nor crowded",
        description=(
            "Measures the share of the slide covered by content and reports slides below or "
            "above the profile band. Title and section slides are exempt from the lower bound."
        ),
        severity="minor",
        defaults={"minFill": 0.25, "maxFill": 0.75},
    ),
    CheckDefinition(
        id="placeholder-text",
        category="content",
        title="No placeholder text is left",
        description=(
            "Scans the deck for filler strings that must never reach a user, listed per profile "
            "in configs/audit.yaml, and for text boxes left empty."
        ),
        severity="blocker",
        defaults={"forbiddenPatterns": []},
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
