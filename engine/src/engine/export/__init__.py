"""Export layer: writes the slide IR out as .pptx and .pdf.

The exporter reuses the uploaded template as the base file, so masters, theme and fonts come
from the template itself rather than from anything bundled with the service.

Every element of the SlideIR is drawn: text, pictures, tables, charts and the preset
decorations, plus the slide background. The deck a user edits in the browser is exactly this
SlideIR, so the exported file reproduces what the editor shows — the same rectangles the
renderer and the audit measure. Decorations whose geometry was traced to freeform paths cannot
be recreated as native preset shapes and are left out, with a log line.
"""

import logging
import re
import shutil
import subprocess
import tempfile
from collections.abc import Callable, Sequence
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from typing import Any

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.dml import MSO_LINE_DASH_STYLE
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE, MSO_SHAPE_TYPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.presentation import Presentation as PresentationDocument
from pptx.shapes.autoshape import Shape
from pptx.util import Emu, Pt

from engine.contracts import SlideIR

__all__ = ["DrawVisual", "export_pdf", "export_pptx"]

logger = logging.getLogger(__name__)

#: Draws one table or chart element onto a slide's shape tree. The API passes the visuals
#: layer's drawer here, so export writes native visuals without importing another layer.
type DrawVisual = Callable[[Any, dict[str, Any], dict[str, Any]], None]

#: Longest a PDF conversion may take before it counts as failed.
_PDF_TIMEOUT_S = 120

#: OOXML preset decorations the parser knows by name, mapped onto python-pptx autoshapes.
#: A straight line is a connector rather than an autoshape and is drawn separately.
_DECOR_PRESETS: dict[str, Any] = {
    "rect": MSO_SHAPE.RECTANGLE,
    "round-rect": MSO_SHAPE.ROUNDED_RECTANGLE,
    "ellipse": MSO_SHAPE.OVAL,
    "triangle": MSO_SHAPE.ISOSCELES_TRIANGLE,
    "diamond": MSO_SHAPE.DIAMOND,
}

_DASH_STYLES: dict[str, Any] = {
    "solid": MSO_LINE_DASH_STYLE.SOLID,
    "dash": MSO_LINE_DASH_STYLE.DASH,
    "dot": MSO_LINE_DASH_STYLE.ROUND_DOT,
}

_ALIGN = {
    "left": PP_ALIGN.LEFT,
    "center": PP_ALIGN.CENTER,
    "right": PP_ALIGN.RIGHT,
    "justify": PP_ALIGN.JUSTIFY,
}

_VERTICAL_ALIGN = {
    "top": MSO_ANCHOR.TOP,
    "middle": MSO_ANCHOR.MIDDLE,
    "bottom": MSO_ANCHOR.BOTTOM,
}

_HEX = re.compile(r"^[0-9a-fA-F]{6}$")


def export_pptx(
    slides: Sequence[SlideIR | dict[str, Any]],
    design_system: dict[str, Any],
    template_path: Path,
    destination: Path,
    draw_visual: DrawVisual | None = None,
    external_media: dict[str, bytes] | None = None,
) -> Path:
    """Write the deck as a .pptx built on the uploaded template.

    Args:
        slides: Slide IR produced by the layout layer, edited by the user, or as plain JSON.
        design_system: Design tokens extracted from the source template.
        template_path: Source template that supplies masters, theme and layout definitions.
        destination: Where to write the resulting presentation.
        draw_visual: Writes tables and charts. Without it they are left out.
        external_media: Pictures the editor added, keyed by their exact media part. The API has
            already read the files; this layer only embeds the bytes it is given.

    Returns:
        Path to the written file.
    """
    presentation = Presentation(str(template_path))
    source_slides = list(presentation.slides)
    # The template's pictures must be read before its slides are dropped: removing them from the
    # presentation part severs the relationships the package walk follows to the media.
    media = _merge_template_media(presentation, external_media)
    palette = {entry["role"]: entry["hex"] for entry in design_system["palette"]}
    type_scale = {style["role"]: style for style in design_system["typeScale"]}
    serialized_slides = [
        slide_ir.model_dump(mode="json", exclude_unset=True)
        if isinstance(slide_ir, SlideIR)
        else slide_ir
        for slide_ir in slides
    ]
    if _can_preserve_source_slides(serialized_slides, source_slides):
        return _export_from_source_slides(
            presentation,
            source_slides,
            serialized_slides,
            design_system,
            palette,
            type_scale,
            media,
            destination,
            draw_visual,
        )

    _remove_existing_slides(presentation)
    layout = _blank_layout(presentation)
    for data in serialized_slides:
        slide = presentation.slides.add_slide(layout)
        _draw_background(slide, data, media, palette, presentation)
        for element in data.get("elements", []):
            _draw_element(slide, element, design_system, palette, type_scale, media, draw_visual)

    destination.parent.mkdir(parents=True, exist_ok=True)
    presentation.save(str(destination))
    return destination


def _can_preserve_source_slides(
    slides: Sequence[dict[str, Any]], source_slides: Sequence[Any]
) -> bool:
    """Return whether every edited slide is rooted in a source slide in this deck."""
    return bool(source_slides) and all(
        isinstance(data.get("index"), int)
        and 0 <= data["index"] < len(source_slides)
        and any(element.get("sourceShapeId") is not None for element in data.get("elements", []))
        for data in slides
    )


def _export_from_source_slides(
    presentation: PresentationDocument,
    source_slides: Sequence[Any],
    slides: Sequence[dict[str, Any]],
    design_system: dict[str, Any],
    palette: dict[str, str],
    type_scale: dict[str, dict[str, Any]],
    media: dict[str, bytes],
    destination: Path,
    draw_visual: DrawVisual | None,
) -> Path:
    """Clone source slides before applying editor changes to their native objects."""
    for data in slides:
        slide = _clone_slide(presentation, source_slides[data["index"]])
        _apply_source_background(slide, data, palette)
        elements = data.get("elements", [])
        known_shapes = {
            str(shape.shape_id): (shape, in_group) for shape, in_group in _all_shapes(slide.shapes)
        }
        # Ids of shapes that live on the slide. Master and layout ids are a different namespace
        # and must not keep, or hide, a slide shape that happens to share the number.
        bound_shape_ids = _slide_shape_ids(elements)
        _remove_unbound_text_shapes(slide, bound_shape_ids)
        _remove_unbound_pictures(slide, bound_shape_ids)
        paint_order: list[Any] = []
        for element in elements:
            if _inherited(element):
                # The clone still inherits this graphic. Drawing it again appends a second copy
                # above the slide's own text.
                continue
            source_id = element.get("sourceShapeId")
            source = known_shapes.get(str(source_id)) if source_id is not None else None
            if source is not None:
                _apply_existing_element(source[0], element, palette, source[1])
                paint_order.append(source[0]._element)
            else:
                before = {id(shape._element) for shape, _group in _all_shapes(slide.shapes)}
                _draw_element(
                    slide, element, design_system, palette, type_scale, media, draw_visual
                )
                for shape, _group in _all_shapes(slide.shapes):
                    if id(shape._element) not in before:
                        paint_order.append(shape._element)
        _order_with_parents(paint_order)

    _remove_initial_slides(presentation, len(source_slides))
    destination.parent.mkdir(parents=True, exist_ok=True)
    presentation.save(str(destination))
    return destination


def _clone_slide(presentation: PresentationDocument, source: Any) -> Any:
    """Clone slide XML together with every relationship it references."""
    slide = presentation.slides.add_slide(source.slide_layout)
    for child in list(slide._element):
        slide._element.remove(child)
    for child in source._element:
        slide._element.append(deepcopy(child))
    slide.__dict__.pop("shapes", None)
    relationship_ids = {}
    for rel in source.part.rels.values():
        if rel.reltype.endswith("/notesSlide"):
            continue
        relationship_ids[rel.rId] = slide.part.relate_to(
            rel.target_ref if rel.is_external else rel.target_part,
            rel.reltype,
            is_external=rel.is_external,
        )
    for element in slide._element.iter():
        for attribute, value in list(element.attrib.items()):
            if attribute.endswith("}id") and value in relationship_ids:
                element.set(attribute, relationship_ids[value])
    return slide


def _apply_source_background(slide: Any, data: dict[str, Any], palette: dict[str, str]) -> None:
    """Apply an editor background override without replacing native slide artwork."""
    if "background" not in data:
        return
    background = _resolve_color(data.get("background"), palette)
    if background is None:
        slide.background.fill.background()
        return
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = RGBColor.from_string(background)


def _inherited(element: dict[str, Any]) -> bool:
    """True when the element is master or layout artwork, not a shape of the slide."""
    return element.get("sourcePart") in {"layout", "master"}


def _slide_shape_ids(elements: Sequence[dict[str, Any]]) -> set[str]:
    """Shape ids the editor still shows that belong to the slide part."""
    return {
        str(element["sourceShapeId"])
        for element in elements
        if element.get("sourceShapeId") is not None and not _inherited(element)
    }


def _remove_unbound_text_shapes(slide: Any, bound_shape_ids: set[str]) -> None:
    """Remove top-level text boxes the editor removed from the slide IR."""
    for shape in list(slide.shapes):
        if (
            shape.has_text_frame
            and shape.text.strip()
            and str(shape.shape_id) not in bound_shape_ids
        ):
            shape._element.getparent().remove(shape._element)


def _remove_unbound_pictures(slide: Any, bound_shape_ids: set[str]) -> None:
    """Remove slide pictures the editor deleted. Inherited pictures are not on this tree."""
    for shape, _group in list(_all_shapes(slide.shapes)):
        if shape.shape_type != MSO_SHAPE_TYPE.PICTURE:
            continue
        if str(shape.shape_id) in bound_shape_ids:
            continue
        parent = shape._element.getparent()
        if parent is not None:
            parent.remove(shape._element)


def _order_with_parents(ordered: Sequence[Any]) -> None:
    """Put shapes in paint order inside the parent they already belong to.

    OOXML draws a parent's children from back to front. Moving each kept shape to the end of its
    own parent, in SlideIR order, leaves a picture that the editor placed behind text behind it,
    and a picture the editor placed in front in front. A shape inside a group stays in that group.
    """
    by_parent: dict[Any, list[Any]] = {}
    for element in ordered:
        parent = element.getparent()
        while parent is not None:
            by_parent.setdefault(parent, []).append(element)
            if parent.tag != qn("p:grpSp"):
                break
            element = parent
            parent = element.getparent()
    for parent, elements in by_parent.items():
        for element in elements:
            parent.remove(element)
            parent.append(element)


def _apply_existing_element(
    shape: Any, element: dict[str, Any], palette: dict[str, str], in_group: bool
) -> None:
    """Update only properties represented by the edited element and retain native drawing."""
    box = element.get("box")
    if isinstance(box, dict) and not in_group:
        shape.left = Emu(box["x"])
        shape.top = Emu(box["y"])
        shape.width = Emu(box["cx"])
        shape.height = Emu(box["cy"])
    if element.get("rotation") is not None and not in_group:
        shape.rotation = element["rotation"]
    opacity = element.get("opacity")
    if isinstance(opacity, (int, float)) and 0 <= opacity < 1:
        _apply_opacity(shape, float(opacity))
    if element.get("kind") != "text" or not shape.has_text_frame:
        return
    _replace_text_from_ir(shape, element, palette)


def _replace_text_from_ir(shape: Any, element: dict[str, Any], palette: dict[str, str]) -> None:
    """Write editor text styling while retaining the native text frame and its margins."""
    frame = shape.text_frame
    vertical_align = element.get("verticalAlign")
    if vertical_align in _VERTICAL_ALIGN:
        frame.vertical_anchor = _VERTICAL_ALIGN[vertical_align]
    insets = element.get("textInsets")
    if isinstance(insets, dict):
        frame.margin_left = Emu(insets["l"])
        frame.margin_top = Emu(insets["t"])
        frame.margin_right = Emu(insets["r"])
        frame.margin_bottom = Emu(insets["b"])
    frame.clear()
    for index, paragraph in enumerate(element.get("paragraphs", [])):
        target = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        target.level = paragraph.get("level", 0)
        align = paragraph.get("align")
        if align in _ALIGN:
            target.alignment = _ALIGN[align]
        for run in paragraph.get("runs", []):
            written = target.add_run()
            written.text = run.get("text", "")
            if run.get("font"):
                written.font.name = run["font"]
            if run.get("sizePt"):
                written.font.size = Pt(run["sizePt"])
            if run.get("bold") is not None:
                written.font.bold = run["bold"]
            if run.get("italic") is not None:
                written.font.italic = run["italic"]
            color = _resolve_color(run.get("color"), palette)
            if color is not None:
                written.font.color.rgb = RGBColor.from_string(color)


def _all_shapes(shapes: Any, in_group: bool = False) -> Any:
    """Yield shapes inside groups as well as top-level slide objects."""
    for shape in shapes:
        yield shape, in_group
        if hasattr(shape, "shapes"):
            yield from _all_shapes(shape.shapes, in_group=True)


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


# ------------------------------------------------------------------------------------- drawing


def _draw_element(
    slide: Any,
    element: dict[str, Any],
    design_system: dict[str, Any],
    palette: dict[str, str],
    type_scale: dict[str, dict[str, Any]],
    media: dict[str, bytes],
    draw_visual: DrawVisual | None,
) -> None:
    """Draw one SlideIR element; unknown kinds are skipped, never fatal."""
    kind = element.get("kind")
    if kind in {"table", "chart"} and draw_visual is not None:
        draw_visual(slide.shapes, element, design_system)
    elif kind == "text":
        _draw_text(slide.shapes, element, palette, type_scale)
    elif kind == "image":
        _draw_image(slide.shapes, element, media)
    elif kind == "decor":
        _draw_decor(slide.shapes, element, palette)


def _draw_background(
    slide: Any,
    data: dict[str, Any],
    media: dict[str, bytes],
    palette: dict[str, str],
    presentation: PresentationDocument,
) -> None:
    """Paint the slide fill and its background picture, which sit behind every element."""
    background = _resolve_color(data.get("background"), palette)
    if background is not None:
        try:
            slide.background.fill.solid()
            slide.background.fill.fore_color.rgb = RGBColor.from_string(background)
        except ValueError:
            logger.warning("slide background %s is not a colour", data.get("background"))
    image = data.get("backgroundImage")
    if not image:
        return
    blob = _media_blob(media, image)
    if blob is None:
        logger.warning("background picture %s not found in the template", image)
        return
    picture = slide.shapes.add_picture(
        BytesIO(blob), 0, 0, presentation.slide_width, presentation.slide_height
    )
    # The background picture belongs at the bottom of the paint order.
    tree = slide.shapes._spTree
    element = picture._element
    tree.remove(element)
    tree.insert(2, element)


def _draw_text(
    shapes: Any,
    element: dict[str, Any],
    palette: dict[str, str],
    type_scale: dict[str, dict[str, Any]],
) -> None:
    box = element["box"]
    paragraphs = element.get("paragraphs") or []
    text = "".join(run.get("text", "") for p in paragraphs for run in p.get("runs", []))
    if not text:
        return
    role = element.get("role", "body")
    token = type_scale.get("title" if role == "title" else "body")
    text_box = shapes.add_textbox(Emu(box["x"]), Emu(box["y"]), Emu(box["cx"]), Emu(box["cy"]))
    text_frame = text_box.text_frame
    text_frame.word_wrap = True
    for index, paragraph in enumerate(paragraphs):
        target = text_frame.paragraphs[0] if index == 0 else text_frame.add_paragraph()
        align = paragraph.get("align")
        if align in _ALIGN:
            target.alignment = _ALIGN[align]
        for run in paragraph.get("runs", []):
            draw_run = target.add_run()
            draw_run.text = run.get("text", "")
            font = run.get("font") or (token and token.get("font"))
            if font:
                draw_run.font.name = font
            size = run.get("sizePt")
            if size:
                draw_run.font.size = Pt(size)
            elif token:
                draw_run.font.size = Pt(token["sizePt"])
            bold = run.get("bold")
            if bold is not None:
                draw_run.font.bold = bold
            elif token:
                draw_run.font.bold = bool(token.get("bold", False))
            if run.get("italic"):
                draw_run.font.italic = True
            colour = run.get("color")
            if not colour and token:
                colour = token.get("colorRole")
            resolved = _resolve_color(colour if isinstance(colour, str) else None, palette)
            if resolved is not None:
                draw_run.font.color.rgb = RGBColor.from_string(resolved)
    if element.get("rotation"):
        text_box.rotation = element["rotation"]


def _draw_image(shapes: Any, element: dict[str, Any], media: dict[str, bytes]) -> None:
    blob = _media_blob(media, element.get("mediaPart", ""))
    if blob is None:
        logger.warning("picture %s not found in the template", element.get("mediaPart"))
        return
    box = element["box"]
    box_width = Emu(box["cx"])
    box_height = Emu(box["cy"])
    picture = shapes.add_picture(BytesIO(blob), Emu(box["x"]), Emu(box["y"]))
    intrinsic_width = picture.width
    intrinsic_height = picture.height
    crop = element.get("crop")
    if crop is not None:
        # The crop is the part of the picture that shows; it fills the box as-is.
        picture.crop_left = crop["l"]
        picture.crop_top = crop["t"]
        picture.crop_right = crop["r"]
        picture.crop_bottom = crop["b"]
        picture.width = box_width
        picture.height = box_height
    else:
        contain = element.get("fit", "contain") != "cover"
        scale = (
            min(box_width / intrinsic_width, box_height / intrinsic_height)
            if contain
            else max(box_width / intrinsic_width, box_height / intrinsic_height)
        )
        _place_fitted(
            picture,
            box,
            intrinsic_width * scale,
            intrinsic_height * scale,
            box_width,
            box_height,
        )
    if element.get("rotation"):
        picture.rotation = element["rotation"]
    opacity = element.get("opacity")
    if isinstance(opacity, (int, float)) and 0 <= opacity < 1:
        _apply_opacity(picture, float(opacity))


def _place_fitted(
    picture: Any,
    box: dict[str, int],
    fitted_width: int,
    fitted_height: int,
    box_width: Emu,
    box_height: Emu,
) -> None:
    """Place a picture of fitted size centred in its box; the overflow is cropped evenly."""
    left = box["x"] + (box["cx"] - fitted_width) / 2
    top = box["y"] + (box["cy"] - fitted_height) / 2
    picture.left = Emu(round(left))
    picture.top = Emu(round(top))
    if fitted_width > box_width:
        share = (fitted_width - box_width) / (2 * fitted_width)
        picture.crop_left = share
        picture.crop_right = share
    if fitted_height > box_height:
        share = (fitted_height - box_height) / (2 * fitted_height)
        picture.crop_top = share
        picture.crop_bottom = share
    picture.width = box_width
    picture.height = box_height


def _draw_decor(shapes: Any, element: dict[str, Any], palette: dict[str, str]) -> None:
    if element.get("geometry"):
        # Freeform paths cannot be recreated as a native preset shape without tracing them.
        logger.warning(
            "decoration %s uses traced geometry; left out of the export",
            element.get("elementId"),
        )
        return
    shape_name = element.get("shape")
    box = element["box"]
    if shape_name == "line":
        shape = _draw_line(shapes, box, element, palette)
    else:
        preset = _DECOR_PRESETS.get(shape_name) if isinstance(shape_name, str) else None
        if preset is None:
            return
        shape = shapes.add_shape(
            preset, Emu(box["x"]), Emu(box["y"]), Emu(box["cx"]), Emu(box["cy"])
        )
        fill = _resolve_color(element.get("fill"), palette)
        if fill is not None:
            shape.fill.solid()
            shape.fill.fore_color.rgb = RGBColor.from_string(fill)
        else:
            shape.fill.background()
        _apply_stroke(shape, element.get("stroke"), palette)
        opacity = element.get("opacity")
        if fill is not None and opacity is not None and 0 <= opacity < 1:
            _set_fill_alpha(shape, opacity)
        if element.get("flipH"):
            shape._element.spPr.set("flipH", "1")
        if element.get("flipV"):
            shape._element.spPr.set("flipV", "1")
    if element.get("rotation"):
        shape.rotation = element["rotation"]


def _draw_line(
    shapes: Any, box: dict[str, int], element: dict[str, Any], palette: dict[str, str]
) -> Any:
    """A straight decoration line, drawn as a connector between the corners of its box."""
    connector = shapes.add_connector(
        MSO_CONNECTOR.STRAIGHT,
        Emu(box["x"]),
        Emu(box["y"]),
        Emu(box["x"] + box["cx"]),
        Emu(box["y"] + box["cy"]),
    )
    _apply_stroke(connector, element.get("stroke"), palette)
    return connector


def _apply_stroke(shape: Any, stroke: Any, palette: dict[str, str]) -> None:
    if not isinstance(stroke, dict):
        shape.line.fill.background()
        return
    color = _resolve_color(stroke.get("color"), palette)
    if color is not None:
        shape.line.color.rgb = RGBColor.from_string(color)
    width_emu = stroke.get("widthEmu")
    if width_emu:
        shape.line.width = Emu(width_emu)
    dash = stroke.get("dash")
    if dash in _DASH_STYLES:
        shape.line.dash_style = _DASH_STYLES[dash]


def _apply_opacity(shape: Any, alpha: float) -> None:
    """Fade a picture or a solid shape. Absent opacity leaves the native fill alone."""
    blip = shape._element.find(f".//{qn('a:blip')}")
    if blip is not None:
        existing = blip.find(qn("a:alphaModFix"))
        if existing is not None:
            blip.remove(existing)
        blip.append(blip.makeelement(qn("a:alphaModFix"), {"amt": str(round(alpha * 100000))}))
        return
    _set_fill_alpha(shape, alpha)


def _set_fill_alpha(shape: Shape, alpha: float) -> None:
    solid = shape._element.spPr.find(qn("a:solidFill"))
    if solid is None or not len(solid):
        return
    colour = solid[0]
    alpha_element = colour.makeelement(qn("a:alpha"), {"val": str(int(alpha * 100000))})
    colour.append(alpha_element)


# -------------------------------------------------------------------------------------- helpers


def _resolve_color(value: str | None, palette: dict[str, str]) -> str | None:
    if not value:
        return None
    resolved = palette.get(value, value)
    return resolved if _HEX.match(resolved) else None


def _template_media(presentation: PresentationDocument) -> dict[str, bytes]:
    """Part-name lookup for the template's pictures, by full part path and by file name."""
    media: dict[str, bytes] = {}
    for part in presentation.part.package.iter_parts():
        name = str(part.partname).lstrip("/")
        blob = part.blob
        if not blob or "/media/" not in f"/{name}":
            continue
        media[name] = blob
        media.setdefault(name.rsplit("/", 1)[-1], blob)
    return media


def _merge_template_media(
    presentation: PresentationDocument, external_media: dict[str, bytes] | None
) -> dict[str, bytes]:
    """Template pictures plus editor uploads, which are addressed only by their exact key.

    A template picture is also found by its file name, so older decks that stored just the name
    still resolve. An upload is not: 'upload/logo.png' must not be mistaken for a template part
    that happens to share the name, and a bare name must not pick an upload either.
    """
    media = _template_media(presentation)
    for key, blob in (external_media or {}).items():
        if (
            re.fullmatch(r"upload/[\w.-]+\.(?:png|jpe?g)", key) is None
            or ".." in key
            or key in media
            or not blob
        ):
            raise ValueError(f"External picture {key} is not an upload part.")
        media[key] = blob
    return media


def _media_blob(media: dict[str, bytes], media_part: str) -> bytes | None:
    if media_part.startswith("upload/"):
        return media.get(media_part)
    key = media_part.lstrip("/")
    return media.get(key) or media.get(key.rsplit("/", 1)[-1])


def _remove_existing_slides(presentation: PresentationDocument) -> None:
    for slide_id in list(presentation.slides._sldIdLst):
        presentation.slides._sldIdLst.remove(slide_id)
        presentation.part.drop_rel(slide_id.rId)


def _remove_initial_slides(presentation: PresentationDocument, count: int) -> None:
    """Remove the original slides while retaining clones appended during export."""
    for slide_id in list(presentation.slides._sldIdLst)[:count]:
        presentation.slides._sldIdLst.remove(slide_id)
        presentation.part.drop_rel(slide_id.rId)


def _blank_layout(presentation: PresentationDocument) -> Any:
    return next(
        (layout for layout in presentation.slide_layouts if len(layout.placeholders) == 0),
        presentation.slide_layouts[0],
    )
