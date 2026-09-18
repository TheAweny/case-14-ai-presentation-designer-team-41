"""Builds the .pptx fixtures used by the engine tests.

Fixtures are generated rather than committed: the repository must not carry anyone else's
template, and a generated fixture keeps the tests honest about not knowing the template up front.
"""

from pathlib import Path

__all__ = ["build_fixture_template"]


def build_fixture_template(destination: Path, *, layouts: int = 4) -> Path:
    """Create a synthetic .pptx template for tests.

    Args:
        destination: Where to write the fixture.
        layouts: How many distinct slide layouts the fixture should contain.

    Returns:
        Path to the written fixture.
    """
    raise NotImplementedError
