"""I measure composed copy with installed font metrics without rewriting or resizing it."""

import math
import subprocess
from functools import lru_cache
from typing import Any

from PIL import ImageFont


@lru_cache(maxsize=128)
def _font(family: str, size: float) -> Any:
    try:
        result = subprocess.run(
            ["fc-match", "-f", "%{file}", family],
            capture_output=True,
            text=True,
            check=True,
            timeout=3,
        )
        return ImageFont.truetype(result.stdout.strip(), max(1, round(size * 4)))
    except (OSError, subprocess.SubprocessError):
        return None


def measured_lines(text: str, slot: dict[str, Any]) -> int:
    font = _font(slot.get("font", ""), slot["fontSize"])
    width = slot.get("textWidthPt", 100)

    def length(value: str) -> float:
        return font.getlength(value) / 4 if font else len(value) * slot["fontSize"] * 0.58

    total = 0
    for paragraph in text.replace("\r\n", "\n").replace("\r", "\n").replace("\v", "\n").split("\n"):
        line = ""
        total += 1
        for word in paragraph.split():
            candidate = f"{line} {word}".strip()
            if length(candidate) <= width:
                line = candidate
            else:
                if line:
                    total += 1
                line = word
                if length(word) > width:
                    total += max(0, math.ceil(length(word) / max(1, width)) - 1)
    return total


def measured_height(text: str, slot: dict[str, Any]) -> float:
    """Hard paragraphs carry spacing; a soft break only starts another line."""
    paragraphs = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    line_height = slot["fontSize"] * max(1.0, slot.get("lineSpacing", 1.15))
    spacing = slot.get("spaceBeforePt", 0) + slot.get("spaceAfterPt", 0)
    # Line spacing is the distance between baselines, not padding below the final
    # line. Charging it for a single line rejects the template's own short labels.
    return (
        slot["fontSize"]
        + (measured_lines(text, slot) - 1) * line_height
        + len(paragraphs) * spacing
    )


def broken_words(text: str, slot: dict[str, Any]) -> list[str]:
    """Words wider than the text box on their own: set in the template font, they are torn.

    A line can only wrap between words, so a word that does not fit the width is cut wherever the
    box ends, with no hyphen. The lines it adds can still be inside the slot's limit, which is how
    a title like "Возможности и риски" passes the line count and reads "Возможност / и и риски".
    """
    font = _font(slot.get("font", ""), slot["fontSize"])
    width = slot.get("textWidthPt", 100)

    def length(value: str) -> float:
        return font.getlength(value) / 4 if font else len(value) * slot["fontSize"] * 0.58

    seen: list[str] = []
    for word in text.replace("\v", "\n").split():
        # Punctuation hangs on a word but does not make it a different one.
        bare = word.strip(".,;:!?«»\"'()[]")
        if bare and length(bare) > width and bare not in seen:
            seen.append(bare)
    return seen


#: The least share of its template size a slot's font may shrink to: below it copy stops reading
#: as part of the same slide.
_MIN_SCALE = 0.6

#: The smallest type a reader takes in on a projected slide, in points: a paragraph slot (three
#: lines or more) and a label. Copy is shortened rather than set below these; a template that
#: itself sets a slot smaller keeps its own size and is never shrunk further.
_MIN_BODY_PT = 12.0
_MIN_LABEL_PT = 10.0


def least_scale(slot: dict[str, Any]) -> float:
    """The smallest share of the template font a slot may be set at, by scale and by points."""
    size = float(slot.get("fontSize") or 0)
    if size <= 0:
        return 1.0
    floor_pt = _MIN_BODY_PT if int(slot.get("maxLines") or 1) >= 3 else _MIN_LABEL_PT
    return min(1.0, max(_MIN_SCALE, floor_pt / size))


def fitting_scale(text: str, slot: dict[str, Any]) -> float:
    """The share of the template font at which copy fits its box, 1.0 when it already fits.

    Only for copy the rewriter could not shorten: shrinking it keeps the slide's other shapes
    clear, where overflowing copy would run over them. Tried in steps of 5% down to
    `least_scale`, which is also the answer when nothing fits.
    """
    height = slot.get("textHeightPt")
    least = least_scale(slot)
    for step in range(20, 0, -1):
        if step / 20 < least - 1e-9:
            break
        scaled = {**slot, "fontSize": slot["fontSize"] * step / 20}
        if (height is None or measured_height(text, scaled) <= height) and not broken_words(
            text, scaled
        ):
            return step / 20
    return least


def check_composition_text(
    pattern: dict[str, Any], texts: list[dict[str, str]]
) -> list[dict[str, Any]]:
    """I report overflow against the original box and font rather than silently shrinking text."""
    findings = []
    bindings = {t["slotId"]: t["text"] for t in texts}
    for slot in pattern["slots"]:
        text = bindings.get(slot["slotId"], "")
        if not text:
            continue
        lines = measured_lines(text, slot)
        torn = broken_words(text, slot)
        if torn:
            named = ", ".join(f"«{word}»" for word in torn[:3])
            findings.append(
                {
                    "code": "word-break",
                    "slotId": slot["slotId"],
                    "severity": "error",
                    "lines": lines,
                    "maxLines": slot["maxLines"],
                    "maxChars": max(4, min(slot["maxChars"], len(text))),
                    "message": f"The word {named} is wider than the text box and would be torn "
                    "in the middle. Replace it with a shorter word; do not hyphenate it.",
                }
            )
        height = measured_height(text, slot)
        allowed_height = slot.get("textHeightPt")
        height_overflow = allowed_height is not None and height > allowed_height
        if lines > slot["maxLines"] or len(text) > slot["maxChars"] or height_overflow:
            findings.append(
                {
                    "code": "text-overflow",
                    "slotId": slot["slotId"],
                    "severity": "error",
                    "lines": lines,
                    "maxLines": slot["maxLines"],
                    "maxChars": max(
                        4,
                        min(
                            slot["maxChars"],
                            int(len(text) * slot["maxLines"] / max(1, lines) * 0.85),
                        ),
                    ),
                    "message": "Shorten copy to fit the original template font and text box.",
                }
            )
    return findings
