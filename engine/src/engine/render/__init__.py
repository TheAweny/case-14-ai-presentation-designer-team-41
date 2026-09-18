"""Render layer: rasterises a presentation to PNG with LibreOffice.

Renders feed the visual part of the audit and the preview in the web client. LibreOffice is
called as an external process; the fonts available to it come from the image plus the fonts
embedded in the uploaded template.
"""

from pathlib import Path

__all__ = ["render_to_png"]


def render_to_png(pptx_path: Path, output_dir: Path, dpi: int = 144) -> list[Path]:
    """Render every slide of a presentation to a PNG file.

    Args:
        pptx_path: Presentation to render.
        output_dir: Directory that receives the images.
        dpi: Raster resolution.

    Returns:
        Paths of the rendered images, one per slide, in slide order.
    """
    raise NotImplementedError
