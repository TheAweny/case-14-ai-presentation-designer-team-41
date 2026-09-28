"""I measure composed copy with installed font metrics without rewriting or resizing it."""

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
    for paragraph in text.replace("\v", "\n").split("\n"):
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
                    total += max(0, int(length(word) / max(1, width)))
    return total


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
        if lines > slot["maxLines"] or len(text) > slot["maxChars"]:
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
