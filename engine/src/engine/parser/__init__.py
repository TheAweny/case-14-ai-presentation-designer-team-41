"""Parser layer: turns an uploaded .pptx into a draft template profile.

The parser reads a template as a set of rules — palette, type scale, grid, master layouts,
recurring shape patterns — so the rest of the engine can rebuild a deck in that style. Nothing
here may branch on a specific template: every value comes out of the file.
"""

from pathlib import Path

from engine.contracts.provisional import TemplateProfileDraft

__all__ = ["parse_template"]


def parse_template(template_path: Path) -> TemplateProfileDraft:
    """Read a .pptx template and return a draft profile describing its design system.

    Args:
        template_path: Path to the template uploaded by the user.

    Returns:
        A draft profile: colors, fonts, type scale, grid, layouts and shape patterns.
    """
    raise NotImplementedError
