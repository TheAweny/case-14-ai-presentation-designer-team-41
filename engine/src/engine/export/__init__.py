"""Export layer: writes the slide IR out as .pptx and .pdf.

The exporter reuses the uploaded template as the base file, so masters, theme and fonts come
from the template itself rather than from anything bundled with the service.
"""

from pathlib import Path

from engine.contracts.provisional import SlideIR, TemplateProfile

__all__ = ["export_pdf", "export_pptx"]


def export_pptx(slides: list[SlideIR], profile: TemplateProfile, destination: Path) -> Path:
    """Write the deck as a .pptx built on the uploaded template.

    Args:
        slides: Slide IR produced by the layout layer.
        profile: Template profile, including the path to the template file.
        destination: Where to write the resulting presentation.

    Returns:
        Path to the written file.
    """
    raise NotImplementedError


def export_pdf(pptx_path: Path, destination: Path) -> Path:
    """Convert an exported .pptx to .pdf.

    Args:
        pptx_path: Presentation produced by :func:`export_pptx`.
        destination: Where to write the resulting PDF.

    Returns:
        Path to the written file.
    """
    raise NotImplementedError
