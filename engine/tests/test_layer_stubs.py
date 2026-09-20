"""Every layer still to be written exposes its entry point with the signature of the contract.

The parser has since been implemented, so it left this file: its behaviour is pinned by
``test_parser.py`` instead.
"""

import json
from pathlib import Path

import pytest
from engine.contracts import DeckPlan

from engine import checks, export, layout, render, visuals

_FIXTURES = Path(__file__).resolve().parents[2] / "packages/contracts/fixtures"


def _deck_plan() -> DeckPlan:
    """A real plan rather than an empty dictionary, so the signature is exercised as declared."""
    fixture = json.loads((_FIXTURES / "DeckPlan.json").read_text(encoding="utf-8"))
    return DeckPlan.model_validate(fixture["valid"][0]["payload"])


def test_layout_entry_point_is_declared() -> None:
    with pytest.raises(NotImplementedError):
        layout.build_slide_ir(_deck_plan(), {})


def test_visuals_entry_points_are_declared() -> None:
    with pytest.raises(NotImplementedError):
        visuals.build_chart({}, {})
    with pytest.raises(NotImplementedError):
        visuals.build_table({}, {})


def test_export_entry_points_are_declared() -> None:
    with pytest.raises(NotImplementedError):
        export.export_pptx([], {}, Path("runs/deck.pptx"))
    with pytest.raises(NotImplementedError):
        export.export_pdf(Path("runs/deck.pptx"), Path("runs/deck.pdf"))


def test_render_entry_point_is_declared() -> None:
    with pytest.raises(NotImplementedError):
        render.render_to_png(Path("runs/deck.pptx"), Path("runs/preview"))


def test_checks_entry_point_is_declared() -> None:
    with pytest.raises(NotImplementedError):
        checks.run_deterministic_checks([], {}, {})
