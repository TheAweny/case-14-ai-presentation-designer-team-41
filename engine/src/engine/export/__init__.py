"""Export layer: writes the slide IR out as .pptx and .pdf.

The exporter reuses the uploaded template as the base file, so masters, theme and fonts come
from the template itself rather than from anything bundled with the service.
"""

import shutil
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.presentation import Presentation as PresentationDocument
from pptx.shapes.autoshape import Shape
from pptx.util import Emu, Pt

from engine.contracts import SlideIR

__all__ = ["DrawVisual", "export_pdf", "export_pptx"]

#: Draws one table or chart element onto a slide's shape tree. The API passes the visuals
#: layer's drawer here, so export writes native visuals without importing another layer.
type DrawVisual = Callable[[Any, dict[str, Any], dict[str, Any]], None]

#: Longest a PDF conversion may take before it counts as failed.
_PDF_TIMEOUT_S = 120


def export_pptx(
    slides: list[SlideIR],
    design_system: dict[str, Any],
    template_path: Path,
    destination: Path,
    draw_visual: DrawVisual | None = None,
) -> Path:
    """Write the deck as a .pptx built on the uploaded template.

    Args:
        slides: Slide IR produced by the layout layer.
        design_system: Design tokens extracted from the source template.
        template_path: Source template that supplies masters, theme and layout definitions.
        destination: Where to write the resulting presentation.
        draw_visual: Writes tables and charts. Without it they are left out.

    Returns:
        Path to the written file.
    """
    presentation = Presentation(str(template_path))
    _remove_existing_slides(presentation)
    layout = _blank_layout(presentation)
    for slide_ir in slides:
        slide = presentation.slides.add_slide(layout)
        for element in slide_ir.elements:
            if element.kind in {"table", "chart"} and draw_visual is not None:
                draw_visual(
                    slide.shapes, element.model_dump(mode="json", exclude_unset=True), design_system
                )
                continue
            if element.kind != "text":
                continue
            text = "".join(run.text for paragraph in element.paragraphs for run in paragraph.runs)
            if not text:
                continue
            text_box = slide.shapes.add_textbox(
                Emu(element.box.x), Emu(element.box.y), Emu(element.box.cx), Emu(element.box.cy)
            )
            _apply_text_style(text_box, element.role == "title", text, design_system)

    destination.parent.mkdir(parents=True, exist_ok=True)
    presentation.save(str(destination))
    return destination


def export_pdf(pptx_path: Path, destination: Path) -> Path:
    """Convert an exported .pptx to .pdf with headless LibreOffice.

    Args:
        pptx_path: Presentation produced by :func:`export_pptx`.
        destination: Where to write the resulting PDF.

    Returns:
        Path to the written file.

    Raises:
        RuntimeError: When LibreOffice is not installed or the conversion fails.
    """
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if soffice is None:
        raise RuntimeError("LibreOffice (soffice) is required to export PDF.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as workdir:
        # A private profile directory lets several conversions run at once.
        profile = Path(workdir, "profile").as_uri()
        result = subprocess.run(
            [
                soffice,
                f"-env:UserInstallation={profile}",
                "--headless",
                "--convert-to",
                "pdf",
                "--outdir",
                workdir,
                str(pptx_path),
            ],
            capture_output=True,
            text=True,
            timeout=_PDF_TIMEOUT_S,
            check=False,
        )
        converted = Path(workdir, pptx_path.with_suffix(".pdf").name)
        if result.returncode != 0 or not converted.is_file():
            raise RuntimeError(f"LibreOffice could not convert {pptx_path.name}: {result.stderr}")
        shutil.move(str(converted), destination)
    return destination


def _remove_existing_slides(presentation: PresentationDocument) -> None:
    for slide_id in list(presentation.slides._sldIdLst):
        presentation.slides._sldIdLst.remove(slide_id)
        presentation.part.drop_rel(slide_id.rId)


def _blank_layout(presentation: PresentationDocument) -> Any:
    return next(
        (layout for layout in presentation.slide_layouts if len(layout.placeholders) == 0),
        presentation.slide_layouts[0],
    )


def _apply_text_style(
    shape: Shape, is_title: bool, text: str, design_system: dict[str, Any]
) -> None:
    if shape.shape_type != MSO_SHAPE_TYPE.TEXT_BOX:
        raise ValueError("Expected a native PowerPoint text box.")
    text_frame = shape.text_frame
    text_frame.clear()
    paragraph = text_frame.paragraphs[0]
    run = paragraph.add_run()
    run.text = text
    role = "title" if is_title else "body"
    token = next(style for style in design_system["typeScale"] if style["role"] == role)
    run.font.name = token["font"]
    run.font.size = Pt(token["sizePt"])
    run.font.bold = token["bold"]
    color = next(
        (entry["hex"] for entry in design_system["palette"] if entry["role"] == token["colorRole"]),
        None,
    )
    if color is not None:
        run.font.color.rgb = RGBColor.from_string(color)
