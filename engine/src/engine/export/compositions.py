"""I preserve template objects and replace only the content assigned to their text slots."""

import re
from collections.abc import Callable
from copy import deepcopy
from pathlib import Path
from typing import Any

from PIL import Image
from pptx import Presentation
from pptx.enum.shapes import PP_PLACEHOLDER
from pptx.oxml.xmlchemy import OxmlElement


def _replace_text(shape: Any, text: str) -> None:
    frame = shape.text_frame
    # Composition fit measures wrapped copy in the original box. A template's
    # no-wrap flag must not make accepted replacement text spill beyond that box.
    frame.word_wrap = True
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
        if run_props is None:
            # An empty placeholder keeps the formatting its author set for the first typed
            # character in endParaRPr: PowerPoint applies it to new text, and without it the text
            # falls back to the layout's defaults, often the wrong colour for this slide.
            end = paragraph.find(f"{_A}endParaRPr")
            if end is not None:
                run_props = OxmlElement("a:rPr")
                for key, value in end.attrib.items():
                    run_props.set(key, value)
                for child in end:
                    run_props.append(deepcopy(child))
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


_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"

#: How near the middle of the slide a block must sit to count as centred on it, and how tall it
#: must be to be a block rather than a line, as shares of the slide height.
_CENTRE_TOLERANCE = 0.02
_BLOCK_SHARE = 0.15


def _keep_centred(shape: Any, slide_height: int) -> None:
    """I keep a block the template centred on the slide centred after its text is replaced.

    A statement set large in a panel is often a top-anchored box that grows with its text, sized
    to the template's sample: three lines centred on the slide. One line of new copy keeps the top
    of the box, so it rises above the middle. Anchoring the box at its centre and fixing its size
    puts any number of lines where the sample's middle was.
    """
    # A shape in a group is placed in the group's coordinates, not the slide's.
    if not shape._element.getparent().tag.endswith("}spTree"):
        return
    body = shape.text_frame._txBody.find(f"{_A}bodyPr")
    if body is None or body.find(f"{_A}spAutoFit") is None:
        return
    anchor = body.get("anchor")
    if anchor not in (None, "t") or (anchor is None and shape.is_placeholder):
        return
    top, height = int(shape.top or 0), int(shape.height or 0)
    centre = top + height / 2
    if height < _BLOCK_SHARE * slide_height:
        return
    if abs(centre - slide_height / 2) > _CENTRE_TOLERANCE * slide_height:
        return
    auto = body.find(f"{_A}spAutoFit")
    fixed = OxmlElement("a:noAutofit")
    body.replace(auto, fixed)
    body.set("anchor", "ctr")


_KEPT_PLACEHOLDERS = {
    PP_PLACEHOLDER.FOOTER,
    PP_PLACEHOLDER.DATE,
    PP_PLACEHOLDER.SLIDE_NUMBER,
    PP_PLACEHOLDER.HEADER,
}


def _drop_empty_placeholders(slide: Any) -> None:
    """I remove placeholders the deck leaves empty.

    An empty placeholder is invisible in a PowerPoint slide show, but renderers draw its prompt
    ("Логотип", "Вставьте рисунок") and editors show a frame. Picture placeholders are never filled
    by this pipeline, and an unbound or blank text placeholder has nothing to say.
    """
    for shape in list(_all_shapes(slide.shapes)):
        if not shape.is_placeholder or not shape._element.tag.endswith("}sp"):
            continue
        if shape.placeholder_format.type in _KEPT_PLACEHOLDERS:
            continue
        if shape.has_text_frame and shape.text.strip():
            continue
        shape._element.getparent().remove(shape._element)


def _all_shapes(shapes: Any) -> Any:
    for shape in shapes:
        if hasattr(shape, "shapes"):
            yield from _all_shapes(shape.shapes)
        else:
            yield shape


def _find(shapes: Any, shape_id: str) -> tuple[Any, Any] | None:
    """I find a shape and the collection it lives in, whose coordinates its box is in."""
    for shape in shapes:
        if str(shape.shape_id) == shape_id:
            return shape, shapes
        if hasattr(shape, "shapes"):
            found = _find(shape.shapes, shape_id)
            if found:
                return found
    return None


def _picture_file(run: Path, path: str) -> Path:
    """I resolve a picture path of a composed slide, refusing any path outside the run's media."""
    media = (run / "media").resolve()
    file = (run / path).resolve()
    if not file.is_relative_to(media) or not file.is_file():
        raise ValueError(f"Picture {path} is not in the run's media directory.")
    return file


def _place_picture(slide: Any, slot_id: str, file: Path, fit: str, *, qr: bool = False) -> None:
    """I put a picture where an image slot is and remove the slot.

    The picture takes the slot's box and its place in the drawing order. `cover` crops it to fill
    the box, `contain` fits it whole and centres it; neither stretches it. A card's geometry, such
    as rounded corners, carries over, so the picture keeps the frame the template drew. A QR code
    is the exception: it must stay a rectangle, fitted whole, or the mask clips modules off it.
    """
    found = _find(slide.shapes, slot_id)
    if found is None:
        if qr:
            raise ValueError(f"QR slot {slot_id} was not found on the slide.")
        return
    shape, collection = found
    left, top, width, height = (
        int(v or 0) for v in (shape.left, shape.top, shape.width, shape.height)
    )
    with Image.open(file) as image:
        image_ratio = image.width / image.height
    box_ratio = width / max(1, height)
    # A QR code is never cropped, even when the caller asked for cover: a clipped module is a
    # code that does not scan. The box stays the slot's box, and the picture sits inside it.
    if fit == "contain" or qr:
        if image_ratio > box_ratio:
            fitted = round(width / image_ratio)
            top, height = top + (height - fitted) // 2, fitted
        else:
            fitted = round(height * image_ratio)
            left, width = left + (width - fitted) // 2, fitted
    picture = collection.add_picture(str(file), left, top, width, height)
    if fit != "contain" and not qr:
        if image_ratio > box_ratio:
            side = (1 - box_ratio / image_ratio) / 2
            picture.crop_left = picture.crop_right = side
        else:
            side = (1 - image_ratio / box_ratio) / 2
            picture.crop_top = picture.crop_bottom = side
    if not qr:
        geometry = shape._element.find(f".//{_A}prstGeom")
        if geometry is not None:
            properties = picture._element.spPr
            current = properties.find(f"{_A}prstGeom")
            if current is not None:
                properties.replace(current, deepcopy(geometry))
    picture.name = f"Illustration {slot_id}"
    element = shape._element
    parent = element.getparent()
    parent.insert(parent.index(element), picture._element)
    parent.remove(element)


#: Words of a period or a unit that a figure label is made of: «III кв.», «Q3», «70 млн», «Июл».
_PERIOD_WORD = re.compile(
    r"^(?:[ivx]{1,4}|q[1-4]|h[12]|кв|квартал\w*|г|гг|год\w*|лет|мес|месяц\w*|млн|млрд|тыс|руб|₽|"
    r"янв\w*|фев\w*|мар\w*|апр\w*|ма[йя]|июн\w*|июл\w*|авг\w*|сен\w*|окт\w*|ноя\w*|дек\w*|"
    r"jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*|"
    r"usd|eur|rub|%)$",
    re.IGNORECASE,
)
_EDGE_PUNCTUATION = ".,;:()/-–—"


#: Units that are no figure on their own: «млн» says what a number counts, not which.
_UNIT_WORDS = frozenset({"кв", "г", "гг", "лет", "мес", "млн", "млрд", "тыс", "руб", "₽", "%"})


def figure_sample(sample: str) -> bool:
    """Whether a template sample is only a figure or a period label: «05», «2,4%», «III кв.».

    Such a sample means nothing without the facts it stood for. Left as it is, it reads on the
    new slide as a fact of the deck, so a slot the writer left empty for lack of one is removed
    with its shape rather than kept as a blank badge.
    """
    tokens = [word.strip(_EDGE_PUNCTUATION) for word in sample.split()]
    tokens = [token for token in tokens if token]
    figure = False
    for token in tokens:
        if any(char.isdigit() for char in token):
            figure = True
        elif _PERIOD_WORD.match(token):
            figure = figure or token.lower() not in _UNIT_WORDS
        else:
            return False
    return figure


def _remove_shape(slide: Any, slot_id: str) -> None:
    found = _find(slide.shapes, slot_id)
    if found is not None:
        element = found[0]._element
        element.getparent().remove(element)


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
    if visual["kind"] == "native":
        draw(slide.shapes, {**visual, "box": box})
        return
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
                _keep_centred(shape, int(presentation.slide_height or 0))
        if item.get("visual") and draw_visual is not None:
            _replace_with_visual(slide, item["visual"], draw_visual)
        # A figure or period label the template drew as a sample and no fact filled: the writer
        # left it empty, and a blank badge or label reads worse than none.
        samples = {str(slot["slotId"]): slot.get("sample", "") for slot in pattern["slots"]}
        carried = str((item.get("visual") or {}).get("slotId", ""))
        for slot_id, text in texts.items():
            if slot_id != carried and not text.strip() and figure_sample(samples.get(slot_id, "")):
                _remove_shape(slide, slot_id)
        # Every image slot gets its picture or leaves the slide: an empty frame or a blank card
        # reads as a slide nobody finished.
        pictures = {p["slotId"]: p for p in item.get("images") or []}
        if len(pictures) != len(item.get("images") or []):
            raise ValueError("Bind each picture slot at most once.")
        qr_slots = {
            s["slotId"]
            for s in (pattern.get("qrCandidateSlots") or []) + (pattern.get("imageSlots") or [])
        }
        for slot_id, chosen in pictures.items():
            if chosen.get("purpose") != "qr":
                continue
            if slot_id not in qr_slots:
                raise ValueError(f"Unknown QR slot {slot_id}.")
            _place_picture(
                slide, slot_id, _picture_file(output.parent, chosen["path"]), "contain", qr=True
            )
        for image_slot in pattern.get("imageSlots") or []:
            chosen = pictures.get(image_slot["slotId"])
            if chosen is not None and chosen.get("purpose") == "qr":
                continue
            if chosen is None:
                # A sample photo with no picture for it stays: the slide keeps a photo, not a hole.
                if image_slot.get("kind") != "photo":
                    _remove_shape(slide, image_slot["slotId"])
            else:
                file = _picture_file(output.parent, chosen["path"])
                _place_picture(
                    slide,
                    image_slot["slotId"],
                    file,
                    chosen["fit"],
                    qr=chosen.get("purpose") == "qr",
                )
        _drop_empty_placeholders(slide)
        notes = slide.notes_slide.notes_text_frame
        if notes is not None:
            notes.text = item.get("speakerNotes", "")
    for slide_id in list(presentation.slides._sldIdLst)[: len(originals)]:
        presentation.slides._sldIdLst.remove(slide_id)
        presentation.part.drop_rel(slide_id.rId)
    output.parent.mkdir(parents=True, exist_ok=True)
    presentation.save(str(output))
    return output
