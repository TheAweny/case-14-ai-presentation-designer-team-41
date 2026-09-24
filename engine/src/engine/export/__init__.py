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

from engine.contracts import SlideIR, TemplateProfile

__all__ = ["export_pdf", "export_pptx"]


def export_pptx(
    slides: list[SlideIR], profile: TemplateProfile, template_path: Path, destination: Path
) -> Path:
    """Write the deck as a .pptx built on the uploaded template.

    Args:
        slides: Slide IR produced by the layout layer.
        profile: Template profile extracted from the source template.
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
        for object_ir in slide_ir.objects:
            if object_ir.kind.value != "text" or object_ir.text is None:
                continue
            text_box = slide.shapes.add_textbox(
                Emu(round(object_ir.bbox.x * 12_700)),
                Emu(round(object_ir.bbox.y * 12_700)),
                Emu(round(object_ir.bbox.width * 12_700)),
                Emu(round(object_ir.bbox.height * 12_700)),
            )
            _apply_text_style(
                text_box, object_ir.objectId.startswith("title-"), object_ir.text, profile
            )

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


def _apply_text_style(shape: Shape, is_title: bool, text: str, profile: TemplateProfile) -> None:
    if shape.shape_type != MSO_SHAPE_TYPE.TEXT_BOX:
        raise ValueError("Expected a native PowerPoint text box.")
    text_frame = shape.text_frame
    text_frame.clear()
    paragraph = text_frame.paragraphs[0]
    run = paragraph.add_run()
    run.text = text
    if not profile.typography:
        return
    token = (
        max(profile.typography, key=lambda item: item.sizePt)
        if is_title
        else min(profile.typography, key=lambda item: item.sizePt)
    )
    run.font.name = token.family
    run.font.size = Pt(token.sizePt)
    run.font.bold = token.weight >= 700
    if profile.palette:
        run.font.color.rgb = RGBColor.from_string(profile.palette[0].root.removeprefix("#"))
