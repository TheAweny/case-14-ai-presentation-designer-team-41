"""Unimplemented layers remain explicit until their owning backlog item starts."""

from pathlib import Path
from typing import cast

import pytest
from engine.contracts import TemplateProfile

from engine import checks, export, render, visuals


def test_visuals_entry_points_are_declared() -> None:
    with pytest.raises(NotImplementedError):
        visuals.build_chart({}, cast(TemplateProfile, {}))
    with pytest.raises(NotImplementedError):
        visuals.build_table({}, cast(TemplateProfile, {}))


def test_export_pdf_entry_point_is_declared() -> None:
    with pytest.raises(NotImplementedError):
        export.export_pdf(Path("runs/deck.pptx"), Path("runs/deck.pdf"))


def test_render_entry_point_is_declared() -> None:
    with pytest.raises(NotImplementedError):
        render.render_to_png(Path("runs/deck.pptx"), Path("runs/preview"))


def test_checks_entry_point_is_declared() -> None:
    with pytest.raises(NotImplementedError):
        checks.run_deterministic_checks([], cast(TemplateProfile, {}), {})
