"""I verify preservation of template geometry and rejection of ungrounded bindings."""

from pathlib import Path
from typing import Any, cast

import pytest
from engine.api import app
from engine.export.compositions import export_compositions
from engine.parser.compositions import extract_compositions
from fastapi.testclient import TestClient
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE, MSO_SHAPE_TYPE, PP_PLACEHOLDER
from pptx.shapes.autoshape import Shape
from pptx.util import Emu, Inches, Pt

_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"


def template(path: Path) -> Path:
    deck = Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[6])
    shape = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(7), Inches(2))
    shape.text_frame.paragraphs[0].add_run().text = "Source title"
    shape.text_frame.paragraphs[0].runs[0].font.size = Pt(30)
    deck.save(str(path))
    return path


def test_compositions_come_from_actual_template(tmp_path: Path) -> None:
    result = extract_compositions(template(tmp_path / "unknown.pptx"))
    assert len(result) == 1
    assert result[0]["slots"][0]["sample"] == "Source title"
    assert result[0]["slots"][0]["maxChars"] > 0


def test_export_preserves_geometry_and_font(tmp_path: Path) -> None:
    source = template(tmp_path / "source.pptx")
    pattern = extract_compositions(source)[0]
    output = tmp_path / "result.pptx"
    export_compositions(
        source,
        output,
        [
            {
                "patternId": pattern["patternId"],
                "texts": [{"slotId": pattern["slots"][0]["slotId"], "text": "New title"}],
                "speakerNotes": "Notes",
            }
        ],
        [pattern],
    )
    shape = cast(Shape, Presentation(str(output)).slides[0].shapes[0])
    assert shape.text == "New title"
    assert shape.left == Inches(1)
    assert shape.text_frame.paragraphs[0].runs[0].font.size == Pt(30)


def test_export_rejects_unknown_pattern(tmp_path: Path) -> None:
    source = template(tmp_path / "source.pptx")
    with pytest.raises(ValueError, match="pattern"):
        export_compositions(
            source,
            tmp_path / "out.pptx",
            [{"patternId": "missing", "texts": [], "speakerNotes": ""}],
            extract_compositions(source),
        )


def test_export_rejects_missing_slot(tmp_path: Path) -> None:
    source = template(tmp_path / "source.pptx")
    pattern = extract_compositions(source)[0]
    with pytest.raises(ValueError, match="slot"):
        export_compositions(
            source,
            tmp_path / "out.pptx",
            [{"patternId": pattern["patternId"], "texts": [], "speakerNotes": ""}],
            [pattern],
        )


def _card_deck(path: Path, shift: int) -> Path:
    """Two identical cards drawn as groups; the second group is moved, its child is not."""
    deck = Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[6])
    heading = slide.shapes.add_textbox(Inches(1), Inches(0.3), Inches(8), Inches(1))
    heading.text_frame.paragraphs[0].add_run().text = "Slide heading"
    heading.text_frame.paragraphs[0].runs[0].font.size = Pt(44)
    for index in range(2):
        group = slide.shapes.add_group_shape()
        card = group.shapes.add_textbox(Inches(1), Inches(1.2), Inches(3), Inches(1))
        card.text_frame.paragraphs[0].add_run().text = "Card label"
        card.text_frame.paragraphs[0].runs[0].font.size = Pt(28)
        if index:
            off = group._element.grpSpPr.find(
                "{http://schemas.openxmlformats.org/drawingml/2006/main}xfrm"
            ).find("{http://schemas.openxmlformats.org/drawingml/2006/main}off")
            off.set("x", str(int(off.get("x")) + shift))
    deck.save(str(path))
    return path


def test_slots_inside_moved_groups_get_slide_coordinates(tmp_path: Path) -> None:
    shift = int(Inches(4))
    slots = extract_compositions(_card_deck(tmp_path / "cards.pptx", shift))[0]["slots"]
    cards = sorted((s for s in slots if s["sample"] == "Card label"), key=lambda s: s["box"]["x"])
    assert len(cards) == 2
    assert cards[1]["box"]["x"] - cards[0]["box"]["x"] == shift


def test_group_at_its_own_origin_keeps_the_child_box(tmp_path: Path) -> None:
    slots = extract_compositions(_card_deck(tmp_path / "cards.pptx", 0))[0]["slots"]
    cards = [s for s in slots if s["sample"] == "Card label"]
    assert {s["box"]["x"] for s in cards} == {int(Inches(1))}


def test_a_composition_has_one_title_and_card_headers_stay_body(tmp_path: Path) -> None:
    slots = extract_compositions(_card_deck(tmp_path / "cards.pptx", int(Inches(4))))[0]["slots"]
    titles = [s for s in slots if s["role"] == "title"]
    assert [s["sample"] for s in titles] == ["Slide heading"]
    assert all(s["role"] == "body" for s in slots if s["sample"] == "Card label")


def _placeholder_deck(path: Path) -> Path:
    """A design shipped as an empty layout slide: copy exists only as the layout's prompts."""
    deck = Presentation()
    deck.slides.add_slide(deck.slide_layouts[1])
    deck.save(str(path))
    return path


def test_empty_placeholders_become_slots_sampled_by_their_prompt(tmp_path: Path) -> None:
    patterns = extract_compositions(_placeholder_deck(tmp_path / "layout.pptx"))
    assert len(patterns) == 1
    slots = patterns[0]["slots"]
    assert [s["role"] for s in slots] == ["title", "body"]
    assert all(s["prompt"] is True and s["sample"] for s in slots)
    body = next(s for s in slots if s["role"] == "body")
    # The master's outline levels are not content; only the first prompt line is the sample.
    assert "\n" not in body["sample"]
    assert body["maxChars"] > len(body["sample"]) * 2


def test_filled_text_is_not_marked_as_a_prompt(tmp_path: Path) -> None:
    slot = extract_compositions(template(tmp_path / "filled.pptx"))[0]["slots"][0]
    assert "prompt" not in slot


def test_reference_pages_are_not_offered_as_designs(tmp_path: Path) -> None:
    deck = Presentation()
    links = deck.slides.add_slide(deck.slide_layouts[6])
    box = links.shapes.add_textbox(Inches(1), Inches(1), Inches(6), Inches(1))
    box.text_frame.paragraphs[0].add_run().text = "Useful links: https://example.org"
    kept = deck.slides.add_slide(deck.slide_layouts[6])
    box = kept.shapes.add_textbox(Inches(1), Inches(1), Inches(6), Inches(1))
    box.text_frame.paragraphs[0].add_run().text = "Real design"
    deck.save(str(tmp_path / "reference.pptx"))
    patterns = extract_compositions(tmp_path / "reference.pptx")
    assert [p["sourceIndex"] for p in patterns] == [1]


def test_a_small_header_is_the_title_when_it_stands_above_smaller_copy(tmp_path: Path) -> None:
    deck = Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[6])
    for text, size, top in [("Section header", 20, 0.3), ("01", 36, 1.2), ("Card copy", 14, 2)]:
        box = slide.shapes.add_textbox(Inches(1), Inches(top), Inches(6), Inches(0.6))
        box.text_frame.paragraphs[0].add_run().text = text
        box.text_frame.paragraphs[0].runs[0].font.size = Pt(size)
    deck.save(str(tmp_path / "header.pptx"))
    slots = extract_compositions(tmp_path / "header.pptx")[0]["slots"]
    assert [s["sample"] for s in slots if s["role"] == "title"] == ["Section header"]


def test_generation_profile_omits_unset_slot_fields(tmp_path: Path) -> None:
    source = template(tmp_path / "filled.pptx")
    response = TestClient(app).post("/v1/generation-profile", json={"template_path": str(source)})
    assert response.status_code == 200, response.text
    slot = response.json()["compositions"][0]["slots"][0]
    assert "prompt" not in slot


def _export_layout_slide(tmp_path: Path, layout: int, color: str | None = None) -> Any:
    deck = Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[layout])
    for placeholder in slide.placeholders:
        if placeholder.placeholder_format.type == PP_PLACEHOLDER.PICTURE:
            # A logo-sized frame: a large one would make this a photo design, not offered at all.
            placeholder.width, placeholder.height = Inches(1), Inches(1)
    if color is not None:
        title = slide.shapes.title
        assert title is not None
        paragraph = title.text_frame.paragraphs[0]._p
        end = paragraph.get_or_add_endParaRPr()
        end.set("sz", "3200")
        fill = end.makeelement(f"{_A}solidFill", {})
        fill.append(fill.makeelement(f"{_A}srgbClr", {"val": color}))
        end.append(fill)
    deck.save(str(tmp_path / "layout.pptx"))
    source = tmp_path / "layout.pptx"
    pattern = extract_compositions(source)[0]
    output = tmp_path / "out.pptx"
    export_compositions(
        source,
        output,
        [
            {
                "patternId": pattern["patternId"],
                "texts": [
                    {"slotId": s["slotId"], "text": f"Copy {s['role']}"} for s in pattern["slots"]
                ],
                "speakerNotes": "",
            }
        ],
        [pattern],
    )
    return Presentation(str(output))


def test_text_in_an_empty_placeholder_takes_the_authors_next_text_formatting(
    tmp_path: Path,
) -> None:
    result = _export_layout_slide(tmp_path, 1, color="1F2937")
    title = result.slides[0].shapes.title
    assert title is not None and title.text == "Copy title"
    props = title.text_frame.paragraphs[0]._p.find(f"{_A}r/{_A}rPr")
    assert props is not None
    assert props.get("sz") == "3200"
    assert props.find(f"{_A}solidFill/{_A}srgbClr").get("val") == "1F2937"


def test_unfilled_picture_placeholders_leave_the_exported_slide(tmp_path: Path) -> None:
    result = _export_layout_slide(tmp_path, 8)
    shapes = list(result.slides[0].shapes)
    assert shapes
    assert all(shape.has_text_frame and shape.text.strip() for shape in shapes)


def test_a_photo_frame_and_an_empty_card_are_image_slots(tmp_path: Path) -> None:
    deck = Presentation()
    deck.slides.add_slide(deck.slide_layouts[8])
    text = deck.slides.add_slide(deck.slide_layouts[6])
    box = text.shapes.add_textbox(Inches(0.5), Inches(1), Inches(4), Inches(1))
    box.text_frame.paragraphs[0].add_run().text = "Text design"
    card = text.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(5), Inches(1), Inches(4.5), Inches(5)
    )
    badge = text.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.5), Inches(3), Inches(1), Inches(0.5)
    )
    deck.save(str(tmp_path / "photo.pptx"))
    photo, cards = extract_compositions(tmp_path / "photo.pptx")
    assert [s["kind"] for s in photo["imageSlots"]] == ["placeholder"]
    # The large empty card is a place for a picture; the small badge is decoration.
    assert [s["slotId"] for s in cards["imageSlots"]] == [str(card.shape_id)]
    assert str(badge.shape_id) not in [s["slotId"] for s in cards["imageSlots"]]


def _picture_file(path: Path, size: tuple[int, int]) -> Path:
    from PIL import Image

    Image.new("RGB", size, (40, 160, 90)).save(path)
    return path


def test_a_generated_picture_fills_its_slot_and_an_unfilled_slot_leaves_the_slide(
    tmp_path: Path,
) -> None:
    deck = Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[6])
    box = slide.shapes.add_textbox(Inches(0.5), Inches(1), Inches(4), Inches(1))
    box.text_frame.paragraphs[0].add_run().text = "Text design"
    card = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(5), Inches(1), Inches(4), Inches(5)
    )
    source = tmp_path / "source.pptx"
    deck.save(str(source))
    pattern = extract_compositions(source)[0]
    texts = [{"slotId": s["slotId"], "text": "Озеленение"} for s in pattern["slots"]]
    run = tmp_path / "run"
    (run / "media").mkdir(parents=True)
    _picture_file(run / "media" / "picture.png", (1536, 1024))

    def export(images: list[dict[str, str]]) -> Any:
        output = run / "deck.pptx"
        export_compositions(
            source,
            output,
            [
                {
                    "patternId": pattern["patternId"],
                    "texts": texts,
                    "speakerNotes": "",
                    "images": images,
                }
            ],
            [pattern],
        )
        return Presentation(str(output)).slides[0]

    filled = export([{"slotId": str(card.shape_id), "path": "media/picture.png", "fit": "cover"}])
    pictures = [s for s in filled.shapes if s.shape_type == MSO_SHAPE_TYPE.PICTURE]
    assert len(pictures) == 1
    picture = pictures[0]
    # The picture takes the card's box and keeps its proportions by cropping, not stretching.
    assert (picture.left, picture.top, picture.width, picture.height) == (
        card.left,
        card.top,
        card.width,
        card.height,
    )
    shown = (1536 * (1 - picture.crop_left - picture.crop_right)) / (
        1024 * (1 - picture.crop_top - picture.crop_bottom)
    )
    assert abs(shown - card.width / card.height) < 0.01
    # The card's rounded corners carry over to the picture.
    assert picture._element.spPr.find(f"{_A}prstGeom").get("prst") == "roundRect"
    assert all(s.shape_id != card.shape_id for s in filled.shapes)

    empty = export([])
    assert [s.shape_type for s in empty.shapes] == [MSO_SHAPE_TYPE.TEXT_BOX]


def test_a_sample_photo_is_replaced_by_a_picture_and_stays_without_one(tmp_path: Path) -> None:
    deck = Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[6])
    box = slide.shapes.add_textbox(Inches(0.5), Inches(1), Inches(4), Inches(1))
    box.text_frame.paragraphs[0].add_run().text = "Text design"
    body = slide.shapes.add_textbox(Inches(0.5), Inches(4), Inches(4), Inches(2))
    body.text_frame.paragraphs[0].add_run().text = "Details of the sample slide"
    sample = _picture_file(tmp_path / "sample.png", (800, 800))
    photo = slide.shapes.add_picture(str(sample), Inches(5), Inches(0.5), Inches(4.5), Inches(6))
    icon = slide.shapes.add_picture(str(sample), Inches(0.5), Inches(3), Inches(0.6), Inches(0.6))
    source = tmp_path / "source.pptx"
    deck.save(str(source))
    pattern = extract_compositions(source)[0]
    # The large photo of the sample is a place for a picture; the icon is decoration.
    assert [(s["slotId"], s["kind"]) for s in pattern["imageSlots"]] == [
        (str(photo.shape_id), "photo")
    ]
    run = tmp_path / "run"
    (run / "media").mkdir(parents=True)
    _picture_file(run / "media" / "picture.png", (1536, 1024))

    def export(images: list[dict[str, str]]) -> Any:
        output = run / "deck.pptx"
        texts = [{"slotId": s["slotId"], "text": "Датчики"} for s in pattern["slots"]]
        item = {"patternId": pattern["patternId"], "texts": texts, "speakerNotes": ""}
        export_compositions(source, output, [{**item, "images": images}], [pattern])
        return Presentation(str(output)).slides[0]

    filled = export([{"slotId": str(photo.shape_id), "path": "media/picture.png", "fit": "cover"}])
    boxes = {
        (s.left, s.top, s.width, s.height)
        for s in filled.shapes
        if s.shape_type == MSO_SHAPE_TYPE.PICTURE
    }
    assert (photo.left, photo.top, photo.width, photo.height) in boxes
    assert all(s.shape_id != photo.shape_id for s in filled.shapes)
    kept = export([])
    assert any(s.shape_id == photo.shape_id for s in kept.shapes)
    assert any(s.shape_id == icon.shape_id for s in kept.shapes)


def test_text_is_measured_to_the_edge_of_the_pill_it_sits_on(tmp_path: Path) -> None:
    def title_chars(pill: bool) -> int:
        deck = Presentation()
        slide = deck.slides.add_slide(deck.slide_layouts[6])
        if pill:
            pill_box = (Inches(0.9), Inches(0.4), Inches(3), Inches(0.8))
            slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, *pill_box)
        box = slide.shapes.add_textbox(Inches(1), Inches(0.5), Inches(8), Inches(0.6))
        box.text_frame.paragraphs[0].add_run().text = "Heading"
        box.text_frame.paragraphs[0].runs[0].font.size = Pt(28)
        deck.save(str(tmp_path / "pill.pptx"))
        return extract_compositions(tmp_path / "pill.pptx")[0]["slots"][0]["maxChars"]

    assert title_chars(pill=True) < title_chars(pill=False) / 2


def _statement_deck(path: Path) -> Path:
    """A slide with a large statement centred on it and a title at the top.

    Both are top-anchored boxes that grow with their text, sized to a three-line sample.
    """
    deck = Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[6])
    height = int(deck.slide_height or 0)
    for name, top, box in (
        ("Title", Inches(0.4), Inches(1.2)),
        ("Statement", Emu((height - Inches(3)) // 2), Inches(3)),
    ):
        shape = slide.shapes.add_textbox(Inches(1), top, Inches(6), box)
        shape.name = name
        shape.text_frame.text = "Большой заголовок\nв три\nстроки" if name == "Statement" else name
        body = shape.text_frame._txBody.find(f"{_A}bodyPr")
        assert body is not None
        body.set("anchor", "t")
        for child in list(body):
            body.remove(child)
        body.append(body.makeelement(f"{_A}spAutoFit", {}))
        shape.text_frame.paragraphs[0].runs[0].font.size = Pt(60)
    deck.save(str(path))
    return path


def test_a_statement_centred_on_the_slide_stays_centred_with_fewer_lines(
    tmp_path: Path,
) -> None:
    source = _statement_deck(tmp_path / "source.pptx")
    pattern = extract_compositions(source)[0]
    texts = [{"slotId": s["slotId"], "text": "+15%"} for s in pattern["slots"]]
    output = tmp_path / "out.pptx"
    export_compositions(
        source,
        output,
        [{"patternId": pattern["patternId"], "texts": texts, "speakerNotes": ""}],
        [pattern],
    )
    shapes = {s.name: cast(Shape, s) for s in Presentation(str(output)).slides[0].shapes}
    statement = shapes["Statement"].text_frame._txBody.find(f"{_A}bodyPr")
    title = shapes["Title"].text_frame._txBody.find(f"{_A}bodyPr")
    assert statement is not None and title is not None
    assert statement.get("anchor") == "ctr"
    assert statement.find(f"{_A}spAutoFit") is None
    assert statement.find(f"{_A}noAutofit") is not None
    # A title at the top of the slide keeps its top edge.
    assert title.get("anchor") == "t"
    assert title.find(f"{_A}spAutoFit") is not None
