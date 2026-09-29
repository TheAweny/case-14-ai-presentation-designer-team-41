"""The edited-deck export draws every SlideIR element, not only text.

A deck exported from edited slides must reproduce what the editor shows: pictures, decorations
and the slide background, not floating text on a white slide. The test exports a SlideIR that
carries all of them and reopens the file to read the native objects back.
"""

import struct
import zlib
from pathlib import Path
from typing import cast

from engine.export import export_pptx
from engine.parser import design_system_of
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.shapes.autoshape import Shape
from pptx.util import Inches


def _png(colour: tuple[int, int, int] = (200, 40, 40)) -> bytes:
    """A tiny valid 1x1 PNG, so the test does not depend on an image fixture."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        payload = tag + data
        return (
            struct.pack(">I", len(data))
            + payload
            + struct.pack(">I", zlib.crc32(payload) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    data = zlib.compress(b"\x00" + bytes(colour))
    return (
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", data) + chunk(b"IEND", b"")
    )


def _template(destination: Path, picture: Path) -> Path:
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    slide.shapes.add_picture(str(picture), Inches(2), Inches(2))
    presentation.save(str(destination))
    return destination


def _slide_json() -> dict:
    box = {"x": 914400, "y": 914400, "cx": 5_000_000, "cy": 700_000}
    return {
        "schemaVersion": 1,
        "slideId": "edited-1",
        "variant": "balanced",
        "index": 0,
        "patternId": "/ppt/slideLayouts/slideLayout7.xml",
        "slideCx": 12_192_000,
        "slideCy": 6_858_000,
        "background": "112233",
        "elements": [
            {
                "kind": "text",
                "elementId": "text-1",
                "role": "title",
                "box": box,
                "sourceShapeId": None,
                "paragraphs": [
                    {
                        "level": 0,
                        "align": "left",
                        "runs": [
                            {
                                "text": "Edited title",
                                "font": "Aptos Display",
                                "sizePt": 30,
                                "bold": True,
                                "italic": False,
                                "color": "FFFFFF",
                            }
                        ],
                    }
                ],
                "overflow": None,
            },
            {
                "kind": "image",
                "elementId": "image-1",
                "role": "image",
                "box": {"x": 914400, "y": 2_000_000, "cx": 2_000_000, "cy": 1_500_000},
                "sourceShapeId": None,
                "mediaPart": "/ppt/media/image1.png",
                "fit": "contain",
            },
            {
                "kind": "decor",
                "elementId": "decor-1",
                "role": "decoration",
                "box": {"x": 3_200_000, "y": 4_000_000, "cx": 3_000_000, "cy": 800_000},
                "shape": "rect",
                "fill": "336699",
                "stroke": None,
                "sourceShapeId": None,
            },
        ],
    }


def test_export_draws_pictures_decorations_and_the_background(tmp_path: Path) -> None:
    picture = tmp_path / "pixel.png"
    picture.write_bytes(_png())
    template = _template(tmp_path / "source.pptx", picture)
    design_system = design_system_of(template)
    destination = tmp_path / "edited.pptx"

    # A plain JSON deck, as the web sends it: export must not depend on model round-trips.
    export_pptx([_slide_json()], design_system, template, destination)

    exported = Presentation(str(destination))
    assert len(exported.slides) == 1
    shapes = list(exported.slides[0].shapes)
    # Background fill, the picture element, the rectangle decoration and the title text.
    assert any(shape.shape_type == MSO_SHAPE_TYPE.PICTURE for shape in shapes)
    texts = [
        cast(Shape, shape).text
        for shape in shapes
        if shape.shape_type == MSO_SHAPE_TYPE.TEXT_BOX and shape.has_text_frame
    ]
    assert "Edited title" in texts
    filled = next(
        (cast(Shape, shape) for shape in shapes if shape.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE),
        None,
    )
    assert filled is not None and str(filled.fill.fore_color.rgb) == "336699"


def test_export_keeps_an_empty_text_out_of_the_deck(tmp_path: Path) -> None:
    picture = tmp_path / "pixel.png"
    picture.write_bytes(_png())
    template = _template(tmp_path / "source.pptx", picture)
    design_system = design_system_of(template)
    data = _slide_json()
    data["elements"] = [
        {
            "kind": "text",
            "elementId": "text-empty",
            "role": "body",
            "box": {"x": 0, "y": 0, "cx": 100, "cy": 100},
            "sourceShapeId": None,
            "paragraphs": [
                {
                    "level": 0,
                    "align": None,
                    "runs": [
                        {
                            "text": "",
                            "font": "",
                            "sizePt": None,
                            "bold": None,
                            "italic": None,
                            "color": "",
                        }
                    ],
                }
            ],
            "overflow": None,
        }
    ]
    destination = tmp_path / "empty.pptx"
    export_pptx([data], design_system, template, destination)
    exported = Presentation(str(destination))
    assert all(
        not shape.has_text_frame or not cast(Shape, shape).text
        for shape in exported.slides[0].shapes
    )
