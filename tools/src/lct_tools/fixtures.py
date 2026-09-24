"""Builds the .pptx fixtures used by the engine tests.

Fixtures are generated rather than committed: the repository must not carry anyone else's
template, and a generated fixture keeps the tests honest about not knowing the template up front.

Each builder covers one thing the parser has to survive. They are deliberately small and ugly —
a fixture exists to pin behaviour, not to look like a deck someone would present.
"""

from __future__ import annotations

import zipfile
from collections.abc import Callable
from pathlib import Path

from pptx import Presentation
from pptx.chart.data import ChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.shapes import MSO_SHAPE
from pptx.util import Emu, Inches, Pt

__all__ = ["FIXTURE_BUILDERS", "build_all_fixtures", "build_fixture_template"]

#: A one-pixel PNG, enough to be a real raster part without carrying anyone's artwork.
_PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c636068606000000401000167e4c8f50000000049454e44ae426082"
)


def build_fixture_template(destination: Path, *, layouts: int = 4) -> Path:
    """Create a synthetic .pptx template for tests.

    Args:
        destination: Where to write the fixture.
        layouts: How many distinct slide layouts the fixture should contain.

    Returns:
        Path to the written fixture.
    """
    presentation = Presentation()
    available = presentation.slide_layouts
    for index in range(min(layouts, len(available))):
        slide = presentation.slides.add_slide(available[index])
        if slide.shapes.title is not None:
            slide.shapes.title.text = f"Layout {index + 1}"

    destination.parent.mkdir(parents=True, exist_ok=True)
    presentation.save(str(destination))
    return destination


def _blank(presentation: Presentation):  # type: ignore[valid-type]
    """The blank layout, which every default template carries last."""
    return presentation.slides.add_slide(presentation.slide_layouts[6])


def _groups(destination: Path) -> Path:
    """A group inside a group, so the parser has to flatten more than one level."""
    presentation = Presentation()
    slide = _blank(presentation)
    outer = slide.shapes.add_group_shape()
    inner = outer.shapes.add_group_shape()
    inner.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1), Inches(1), Inches(1), Inches(1))
    outer.shapes.add_shape(MSO_SHAPE.OVAL, Inches(3), Inches(1), Inches(1), Inches(1))
    presentation.save(str(destination))
    return destination


def _rotation(destination: Path) -> Path:
    """A rotated and a flipped shape: geometry that is not axis-aligned."""
    presentation = Presentation()
    slide = _blank(presentation)
    turned = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1), Inches(1), Inches(2), Inches(1))
    turned.rotation = 37.5
    flipped = slide.shapes.add_shape(MSO_SHAPE.CHEVRON, Inches(4), Inches(1), Inches(2), Inches(1))
    flipped._element.spPr.xfrm.set("flipH", "1")
    presentation.save(str(destination))
    return destination


def _theme_colors(destination: Path) -> Path:
    """Text coloured from the theme next to text coloured outright."""
    presentation = Presentation()
    slide = _blank(presentation)
    box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(6), Inches(2))
    frame = box.text_frame
    frame.text = "inherits its colour from the theme"
    explicit = frame.add_paragraph()
    run = explicit.add_run()
    run.text = "states its colour outright"
    run.font.color.rgb = RGBColor(0x00, 0x77, 0xFF)
    presentation.save(str(destination))
    return destination


def _placeholders(destination: Path) -> Path:
    """Title and body placeholders, filled and left empty."""
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[1])
    if slide.shapes.title is not None:
        slide.shapes.title.text = "Title in a placeholder"
    empty = presentation.slides.add_slide(presentation.slide_layouts[1])
    del empty  # the second slide stays untouched on purpose
    presentation.save(str(destination))
    return destination


def _chart(destination: Path) -> Path:
    """A native chart, which the engine must describe rather than rasterise."""
    presentation = Presentation()
    slide = _blank(presentation)
    data = ChartData()
    data.categories = ["one", "two", "three"]
    data.add_series("series", (1.0, 2.0, 3.0))
    slide.shapes.add_chart(
        XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(1), Inches(1), Inches(6), Inches(4), data
    )
    presentation.save(str(destination))
    return destination


def _table(destination: Path) -> Path:
    """A table wide enough to trip the density checks later on."""
    presentation = Presentation()
    slide = _blank(presentation)
    shape = slide.shapes.add_table(4, 3, Inches(1), Inches(1), Inches(6), Inches(3))
    for row in range(4):
        for column in range(3):
            shape.table.cell(row, column).text = f"r{row}c{column}"
    presentation.save(str(destination))
    return destination


def _media(destination: Path) -> Path:
    """An embedded raster, so the media inventory has something to find."""
    presentation = Presentation()
    slide = _blank(presentation)
    from io import BytesIO

    slide.shapes.add_picture(BytesIO(_PNG_1PX), Inches(1), Inches(1), Inches(2), Inches(2))
    presentation.save(str(destination))
    return destination


def _missing_font(destination: Path) -> Path:
    """Text set in a face that is certainly not installed anywhere."""
    presentation = Presentation()
    slide = _blank(presentation)
    box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(6), Inches(1))
    run = box.text_frame.paragraphs[0].add_run()
    run.text = "set in a face nobody has"
    run.font.name = "Nonexistent Brand Grotesk"
    run.font.size = Pt(23)
    presentation.save(str(destination))
    return destination


def _odd_aspect(destination: Path) -> Path:
    """A slide that is neither 16:9 nor 4:3, to catch anything that assumes a ratio."""
    presentation = Presentation()
    presentation.slide_width = Emu(7_000_000)
    presentation.slide_height = Emu(5_000_000)
    slide = _blank(presentation)
    slide.shapes.add_textbox(Inches(1), Inches(1), Inches(3), Inches(1)).text_frame.text = "odd"
    presentation.save(str(destination))
    return destination


def _malformed_xml(destination: Path) -> Path:
    """A package whose presentation part is not well-formed.

    Built by rewriting one part of a valid file, because a hand-written broken package would also
    be missing everything else and would test the wrong failure.
    """
    valid = destination.with_name("_valid_source.pptx")
    Presentation().save(str(valid))

    with zipfile.ZipFile(valid) as source, zipfile.ZipFile(destination, "w") as broken:
        for item in source.infolist():
            payload = source.read(item.filename)
            if item.filename == "ppt/presentation.xml":
                payload = b"<p:presentation><unclosed>"
            broken.writestr(item, payload)

    valid.unlink()
    return destination


def _not_a_package(destination: Path) -> Path:
    """Not a zip at all: the wrong file dropped into the upload form."""
    destination.write_bytes(b"%PDF-1.7\nthis is not a presentation\n")
    return destination


#: Every fixture the parser tests rely on, by name.
FIXTURE_BUILDERS: dict[str, Callable[[Path], Path]] = {
    "groups": _groups,
    "rotation": _rotation,
    "theme-colors": _theme_colors,
    "placeholders": _placeholders,
    "chart": _chart,
    "table": _table,
    "media": _media,
    "missing-font": _missing_font,
    "odd-aspect": _odd_aspect,
    "malformed-xml": _malformed_xml,
    "not-a-package": _not_a_package,
}


def build_all_fixtures(directory: Path) -> dict[str, Path]:
    """Write every fixture into ``directory`` and return them by name."""
    directory.mkdir(parents=True, exist_ok=True)
    return {name: build(directory / f"{name}.pptx") for name, build in FIXTURE_BUILDERS.items()}
