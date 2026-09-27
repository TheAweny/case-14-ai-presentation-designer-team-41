"""I verify preservation of template geometry and rejection of ungrounded bindings."""

from pathlib import Path
from typing import cast

import pytest
from engine.export.compositions import export_compositions
from engine.parser.compositions import extract_compositions
from pptx import Presentation
from pptx.shapes.autoshape import Shape
from pptx.util import Inches, Pt


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
