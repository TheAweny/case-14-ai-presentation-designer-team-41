"""Every layer still to be written exposes its entry point with the signature of the contract.

The parser has since been implemented, so it left this file: its behaviour is pinned by
``test_parser.py`` instead.
"""

from pathlib import Path
from typing import cast

import pytest
from engine.contracts.provisional import TemplateProfile

from engine import checks, export, render, visuals


def test_visuals_entry_points_are_declared() -> None:
    with pytest.raises(NotImplementedError):
        visuals.build_chart({}, cast(TemplateProfile, {}))
    with pytest.raises(NotImplementedError):
        visuals.build_table({}, cast(TemplateProfile, {}))


def test_export_pdf_entry_point_is_declared() -> None:
    with pytest.raises(NotImplementedError):
        export.export_pdf(Path("runs/deck.pptx"), Path("runs/deck.pdf"))


def test_render_rejects_missing_input() -> None:
    with pytest.raises(FileNotFoundError):
        render.render_to_png(Path("runs/deck.pptx"), Path("runs/preview"))


def test_checks_entry_point_is_declared() -> None:
    with pytest.raises(NotImplementedError):
        checks.run_deterministic_checks([], cast(TemplateProfile, {}), {})
