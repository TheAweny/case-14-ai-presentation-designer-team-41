"""Checks layer: the deterministic half of the audit.

Everything measurable lives here: geometry, contrast, counts, fonts, palette, leftover placeholder
text. Judgements that need to read meaning are contextual checks and run on the TypeScript side.

The layer is the verification step for anything that generates slides. It takes an AuditRequest,
measures every slide against the template the deck claims to follow and the limits of an audit
profile, and returns an AuditReport as JSON: findings with evidence and, where the fix can be
computed, a patch.
"""

from typing import Any

from engine.checks._geometry import Template
from engine.checks._rules import RULES, AuditContext
from engine.checks.registry import (
    CATEGORIES,
    DETERMINISTIC_CHECKS,
    CheckDefinition,
    check_by_id,
)

__all__ = [
    "DETERMINISTIC_CHECKS",
    "CheckDefinition",
    "audit_deck",
    "check_by_id",
    "run_deterministic_checks",
]

#: How much each severity costs the score, per slide.
_PENALTY = {"blocker": 25.0, "major": 10.0, "minor": 3.0, "info": 0.0}

#: Findings of these severities keep a deck from shipping.
_BLOCKING = frozenset({"blocker", "major"})


def _settings(
    check: CheckDefinition, profile: dict[str, dict[str, Any]]
) -> tuple[bool, dict[str, Any]]:
    """Whether a check is on under a profile, and its thresholds with the defaults filled in."""
    configured = dict(profile.get(check.id) or {})
    enabled = bool(configured.pop("enabled", True))
    return enabled, {**check.defaults, **configured}


def run_deterministic_checks(
    request: dict[str, Any], profile: dict[str, dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[CheckDefinition]]:
    """Run the enabled deterministic checks over a deck.

    Args:
        request: An AuditRequest in its JSON form.
        profile: Check ids mapped to `enabled` and thresholds, from an audit profile. A check the
            profile does not mention runs with its registered defaults.

    Returns:
        The findings in slide order, then by check, and the checks that ran.
    """
    catalog = request.get("patternCatalog")
    ctx = AuditContext(
        template=Template(request["designSystem"]),
        patterns={p["patternId"]: p for p in catalog["patterns"]} if catalog else None,
        media_sizes=dict(request.get("mediaSizes") or {}),
    )
    active: list[CheckDefinition] = []
    for check in DETERMINISTIC_CHECKS:
        enabled, params = _settings(check, profile)
        if not enabled or (check.id == "template-layout" and ctx.patterns is None):
            continue
        ctx.params[check.id] = params
        active.append(check)
    findings: list[dict[str, Any]] = []
    slides = sorted(request["slides"], key=lambda s: (s["variant"], s["index"]))
    for slide in slides:
        for check in active:
            findings.extend(RULES[check.id](check, slide, ctx))
    return findings, active


def audit_deck(
    request: dict[str, Any], profile_name: str, profile: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    """Audit a deck and summarise the result as an AuditReport in its JSON form.

    The deck passes when nothing of blocker or major severity was found. The score is for ranking
    variants against each other: 100 less the weighted findings per slide.
    """
    findings, active = run_deterministic_checks(request, profile)
    counts = dict.fromkeys(_PENALTY, 0)
    for finding in findings:
        counts[finding["severity"]] += 1
    by_check = {check.id: check.category for check in active}
    categories = []
    for category in CATEGORIES:
        mine = [f for f in findings if by_check[f["checkId"]] == category]
        categories.append(
            {
                "category": category,
                "checks": sum(1 for c in active if c.category == category),
                "findings": len(mine),
                "passed": not any(f["severity"] in _BLOCKING for f in mine),
            }
        )
    slide_count = len(request["slides"])
    penalty = sum(_PENALTY[f["severity"]] for f in findings) / max(slide_count, 1)
    return {
        "schemaVersion": 1,
        "deckId": request["deckId"],
        "profile": profile_name,
        "passed": not any(f["severity"] in _BLOCKING for f in findings),
        "score": round(max(0.0, 100.0 - penalty), 1),
        "slideCount": slide_count,
        "counts": counts,
        "categories": categories,
        "findings": findings,
    }
