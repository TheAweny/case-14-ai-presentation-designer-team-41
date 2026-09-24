"""Parser layer: turns an uploaded .pptx into a draft template profile.

The parser reads a template as a set of rules — palette, type scale, grid, master layouts,
recurring shape patterns — so the rest of the engine can rebuild a deck in that style. Nothing
here may branch on a specific template: every value comes out of the file.
"""

from hashlib import sha256
from pathlib import Path
from typing import Any, cast

from pptx import Presentation
from pptx.enum.dml import MSO_COLOR_TYPE, MSO_FILL

from engine.contracts import TemplateProfile

__all__ = ["parse_template"]


def parse_template(template_path: Path) -> TemplateProfile:
    """Read a .pptx template and return its reusable design profile.

    Args:
        template_path: Path to the template uploaded by the user.

    Returns:
        The shared, validated template profile extracted from the file itself.
    """
    presentation = Presentation(str(template_path))
    palette: list[str] = []
    typography: list[dict[str, object]] = []

    for slide in presentation.slides:
        for shape in slide.shapes:
            _collect_color(shape, palette)
            _collect_typography(shape, typography)

    return TemplateProfile.model_validate(
        {
            "schemaVersion": "1.0.0",
            "templateId": f"template-{_file_sha256(template_path)[:12]}",
            "sourceSha256": _file_sha256(template_path),
            "slideSize": {
                "widthPt": cast(int, presentation.slide_width) / 12_700,
                "heightPt": cast(int, presentation.slide_height) / 12_700,
            },
            "palette": palette[:32],
            "typography": typography[:32],
            "protectedElements": [],
        }
    )


def _file_sha256(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def _collect_color(shape: Any, palette: list[str]) -> None:
    fill = getattr(shape, "fill", None)
    if fill is None or fill.type != MSO_FILL.SOLID:
        return
    foreground = fill.fore_color
    if foreground.type != MSO_COLOR_TYPE.RGB or foreground.rgb is None:
        return
    color = f"#{foreground.rgb}"
    if color not in palette:
        palette.append(color)


def _collect_typography(shape: Any, typography: list[dict[str, object]]) -> None:
    if not getattr(shape, "has_text_frame", False):
        return
    for paragraph in shape.text_frame.paragraphs:
        for run in paragraph.runs:
            if run.font.name is None or run.font.size is None:
                continue
            token = {
                "family": run.font.name,
                "sizePt": run.font.size.pt,
                "weight": 700 if run.font.bold else 400,
            }
            if token not in typography:
                typography.append(token)
