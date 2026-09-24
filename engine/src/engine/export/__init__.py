"""Export layer: writes the slide IR out as .pptx and .pdf.

The exporter reuses the uploaded template as the base file, so masters, theme and fonts come
from the template itself rather than from anything bundled with the service.
"""

from pathlib import Path
from typing import Any

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.presentation import Presentation as PresentationDocument
from pptx.shapes.autoshape import Shape
from pptx.util import Emu, Pt

from engine.contracts import SlideIR

__all__ = ["export_pdf", "export_pptx"]


def export_pptx(
    slides: list[SlideIR], design_system: dict[str, Any], template_path: Path, destination: Path
) -> Path:
    """Write the deck as a .pptx built on the uploaded template.

    Args:
        slides: Slide IR produced by the layout layer.
        design_system: Design tokens extracted from the source template.
        template_path: Source template that supplies masters, theme and layout definitions.
        destination: Where to write the resulting presentation.

    Returns:
        Path to the written file.
    """
    presentation = Presentation(str(template_path))
    _remove_existing_slides(presentation)
    layout = _blank_layout(presentation)
    for slide_ir in slides:
        slide = presentation.slides.add_slide(layout)
        for element in slide_ir.elements:
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
    """Convert an exported .pptx to .pdf.

    Args:
        pptx_path: Presentation produced by :func:`export_pptx`.
        destination: Where to write the resulting PDF.

    Returns:
        Path to the written file.
    """
    raise NotImplementedError


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
