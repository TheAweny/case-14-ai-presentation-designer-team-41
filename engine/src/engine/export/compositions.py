"""I preserve template objects and replace only the content assigned to their text slots."""

from collections.abc import Callable
from copy import deepcopy
from pathlib import Path
from typing import Any

from pptx import Presentation
from pptx.oxml.xmlchemy import OxmlElement


def _replace_text(shape: Any, text: str) -> None:
    frame = shape.text_frame
    originals = list(frame._txBody.p_lst)
    prototypes = [deepcopy(p) for p in originals]
    for paragraph in originals:
        frame._txBody.remove(paragraph)
    for index, line in enumerate(text.split("\n")):
        paragraph = deepcopy(prototypes[min(index, len(prototypes) - 1)])
        run_props = None
        for child in list(paragraph):
            if child.tag.endswith("}r") and run_props is None:
                props = child.find("{http://schemas.openxmlformats.org/drawingml/2006/main}rPr")
                if props is not None:
                    run_props = deepcopy(props)
            if not child.tag.endswith("}pPr") and not child.tag.endswith("}endParaRPr"):
                paragraph.remove(child)
        run = OxmlElement("a:r")
        if run_props is not None:
            # I remove hyperlinks tied to the previous copy while keeping typography.
            for link in list(run_props):
                if "hlink" in link.tag:
                    run_props.remove(link)
            run.append(run_props)
        content = OxmlElement("a:t")
        content.text = line
        run.append(content)
        end = paragraph.find("{http://schemas.openxmlformats.org/drawingml/2006/main}endParaRPr")
        if end is None:
            paragraph.append(run)
        else:
            paragraph.insert(list(paragraph).index(end), run)
        frame._txBody.append(paragraph)


def _all_shapes(shapes: Any) -> Any:
    for shape in shapes:
        if hasattr(shape, "shapes"):
            yield from _all_shapes(shape.shapes)
        else:
            yield shape


#: Draws one table or chart element onto a slide's shape tree; the API passes the visuals layer's.
type DrawVisual = Callable[[Any, dict[str, Any]], None]


def _replace_with_visual(slide: Any, visual: dict[str, Any], draw: DrawVisual) -> None:
    """Swap the text shape of a slot for a native table or chart drawn in the same box."""
    shape = next(
        (s for s in _all_shapes(slide.shapes) if str(s.shape_id) == str(visual["slotId"])), None
    )
    if shape is None:
        return
    box = {
        "x": int(shape.left),
        "y": int(shape.top),
        "cx": int(shape.width),
        "cy": int(shape.height),
    }
    shape._element.getparent().remove(shape._element)
    element: dict[str, Any] = {
        "elementId": f"visual-{visual['slotId']}",
        "role": visual["kind"],
        "box": box,
        "sourceShapeId": None,
    }
    if visual["kind"] == "table":
        element |= {"kind": "table", "headers": visual["headers"], "rows": visual["rows"]}
    else:
        element |= {
            "kind": "chart",
            "chartType": visual["chartType"],
            "categories": visual["categories"],
            "series": visual["series"],
            "xTitle": visual.get("xTitle", ""),
            "yTitle": visual.get("yTitle", ""),
        }
    draw(slide.shapes, element)


def export_compositions(
    source: Path,
    output: Path,
    slides: list[dict[str, Any]],
    patterns: list[dict[str, Any]],
    draw_visual: DrawVisual | None = None,
) -> Path:
    """I clone chosen slides inside their original package, preserving masters and relationships.

    A slide that carries a visual gets it drawn natively in place of the slot it names, when a
    drawer is given.
    """
    presentation = Presentation(str(source))
    originals = list(presentation.slides)
    catalog = {p["patternId"]: p for p in patterns}
    for item in slides:
        pattern = catalog.get(item["patternId"])
        if pattern is None:
            raise ValueError("Unknown template pattern.")
        texts = {t["slotId"]: t["text"] for t in item["texts"]}
        expected = {s["slotId"] for s in pattern["slots"]}
        if set(texts) != expected or len(texts) != len(item["texts"]):
            raise ValueError("Content must bind every template slot exactly once.")
        for slot in pattern["slots"]:
            if len(texts[slot["slotId"]]) > slot["maxChars"]:
                raise ValueError(f"Text overflow in slot {slot['slotId']}.")
        original = originals[pattern["sourceIndex"]]
        slide = presentation.slides.add_slide(original.slide_layout)
        # I copy all slide-level XML, including background and grouped native objects.
        for child in list(slide._element):
            slide._element.remove(child)
        for child in original._element:
            slide._element.append(deepcopy(child))
        slide.__dict__.pop("shapes", None)
        relationship_ids = {}
        for rel in original.part.rels.values():
            if rel.reltype.endswith("/notesSlide"):
                continue
            relationship_ids[rel.rId] = slide.part.relate_to(
                rel.target_ref if rel.is_external else rel.target_part,
                rel.reltype,
                is_external=rel.is_external,
            )
        for element in slide._element.iter():
            for attribute, value in list(element.attrib.items()):
                if (
                    attribute.startswith(
                        "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
                    )
                    and value in relationship_ids
                ):
                    element.set(attribute, relationship_ids[value])
        for shape in _all_shapes(slide.shapes):
            if str(shape.shape_id) in texts:
                _replace_text(shape, texts[str(shape.shape_id)])
        if item.get("visual") and draw_visual is not None:
            _replace_with_visual(slide, item["visual"], draw_visual)
        notes = slide.notes_slide.notes_text_frame
        if notes is not None:
            notes.text = item.get("speakerNotes", "")
    for slide_id in list(presentation.slides._sldIdLst)[: len(originals)]:
        presentation.slides._sldIdLst.remove(slide_id)
        presentation.part.drop_rel(slide_id.rId)
    output.parent.mkdir(parents=True, exist_ok=True)
    presentation.save(str(output))
    return output
