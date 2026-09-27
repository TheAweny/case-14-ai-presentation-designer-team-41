"""I recover reusable text compositions from actual slides without changing their geometry."""

import math
from pathlib import Path
from typing import Any

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE, PP_PLACEHOLDER

from engine.parser._text_style import text_metrics


def _shapes(shapes: Any) -> Any:
    for shape in shapes:
        if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
            yield from _shapes(shape.shapes)
        else:
            yield shape


def extract_compositions(path: Path) -> list[dict[str, Any]]:
    """I expose every editable text slot and its inherited typography to the writer."""
    presentation = Presentation(str(path))
    slide_height = presentation.slide_height
    if slide_height is None:
        raise ValueError("Template has no slide height.")
    patterns = []
    for index, slide in enumerate(presentation.slides):
        slots = []
        shapes = list(_shapes(slide.shapes))
        if any(s.has_chart or s.has_table for s in shapes):
            continue
        links = [r for r in slide.part.rels.values() if r.reltype.endswith("/hyperlink")]
        if len(links) >= 3:
            continue
        for shape in shapes:
            if not shape.has_text_frame or not shape.text.strip():
                continue
            if shape.is_placeholder and shape.placeholder_format.type in (
                PP_PLACEHOLDER.FOOTER,
                PP_PLACEHOLDER.DATE,
                PP_PLACEHOLDER.SLIDE_NUMBER,
            ):
                continue
            text = shape.text.strip()
            # I preserve only actual page numbers, not repeated instructional/sample copy.
            if shape.top > slide_height * 0.88 and text.isdigit():
                continue
            metrics = text_metrics(shape, slide)
            size = metrics["fontSize"]
            line_height = max(size, size * metrics["lineSpacing"])
            lines = max(1, int((metrics["textHeightPt"] + size * 0.15) / line_height))
            chars_per_line = max(1, int(metrics["textWidthPt"] / (size * 0.59)))
            capacity = chars_per_line * lines
            is_title = shape.is_placeholder and shape.placeholder_format.type in (
                PP_PLACEHOLDER.TITLE,
                PP_PLACEHOLDER.CENTER_TITLE,
            )
            if not is_title:
                is_title = size >= 24 and shape.top < slide_height * 0.3
            # I keep text away from decorative art drawn inside oversized source text boxes.
            if not is_title and size >= 14 and lines > 4 and len(text) < 90:
                capacity = min(capacity, max(24, math.ceil(len(text) * 1.15)))
            slots.append(
                {
                    "slotId": str(shape.shape_id),
                    "role": "title" if is_title else "body",
                    "sample": text[:220],
                    "maxChars": max(4, min(capacity, 750)),
                    "maxLines": lines,
                    **metrics,
                    "box": {"x": shape.left, "y": shape.top, "cx": shape.width, "cy": shape.height},
                }
            )
        image_count = sum(s.shape_type == MSO_SHAPE_TYPE.PICTURE for s in shapes)
        if len(slots) == 1 and slots[0]["fontSize"] < 32 and image_count:
            continue
        if slots and len(slots) <= 14:
            for slot in slots:
                box = slot["box"]
                for other in slots:
                    target = other["box"]
                    overlap_x = min(box["x"] + box["cx"], target["x"] + target["cx"]) - max(
                        box["x"], target["x"]
                    )
                    if target["y"] > box["y"] and overlap_x > min(box["cx"], target["cx"]) * 0.5:
                        gap = (target["y"] - box["y"]) / 12700 - 4
                        if gap < slot["textHeightPt"]:
                            slot["textHeightPt"] = max(1.0, gap)
                            old_lines = slot["maxLines"]
                            slot["maxLines"] = max(
                                1, int(gap / (slot["fontSize"] * max(1, slot["lineSpacing"])))
                            )
                            slot["maxChars"] = max(
                                4, int(slot["maxChars"] * slot["maxLines"] / old_lines)
                            )
            slots.sort(key=lambda s: (s["role"] != "title", s["box"]["y"], s["box"]["x"]))
            patterns.append(
                {
                    "patternId": f"source-slide-{index}",
                    "sourceIndex": index,
                    "name": slide.slide_layout.name,
                    "slots": slots,
                    "imageCount": image_count,
                }
            )
    if not patterns:
        raise ValueError("Template contains no usable editable text compositions.")
    return patterns
