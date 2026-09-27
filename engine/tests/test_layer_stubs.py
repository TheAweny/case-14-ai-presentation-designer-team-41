"""Every layer still to be written exposes its entry point with the signature of the contract.

The parser and the checks have since been implemented, so they left this file: their behaviour
is pinned by ``test_parser.py`` and ``test_audit_checks.py`` instead.
"""

from pathlib import Path

import pytest

from engine import render


def test_render_entry_point_is_declared() -> None:
    with pytest.raises(NotImplementedError):
        render.render_to_png(Path("runs/deck.pptx"), Path("runs/preview"))
