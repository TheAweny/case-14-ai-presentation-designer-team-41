"""Measure text with the template face, and say when that face is not installed.

The SlideIR keeps the requested family. A fallback used only to estimate width is reported,
never written back as if the template had asked for it.
"""

from __future__ import annotations

import subprocess
from functools import lru_cache
from typing import Any

from PIL import ImageFont

EMU_PER_PT = 12_700
INSET_X = 2 * 91_440
INSET_Y = 2 * 45_720


@lru_cache(maxsize=128)
def _match(family: str) -> tuple[str | None, str | None]:
    """Return the resolved family and the font file Fontconfig would use."""
    if not family:
        return None, None
    try:
        result = subprocess.run(
            ["fc-match", "-f", "%{family}\\n%{file}", family],
            capture_output=True,
            text=True,
            check=True,
            timeout=3,
        )
    except (OSError, subprocess.SubprocessError):
        return None, None
    family_name, _, file_name = result.stdout.partition("\n")
    resolved = family_name.strip() or None
    file_path = file_name.strip() or None
    return resolved, file_path


@lru_cache(maxsize=256)
def _font(family: str, size_pt: float) -> Any:
    _resolved, file_path = _match(family)
    if not file_path:
        return None
    try:
        return ImageFont.truetype(file_path, max(1, round(size_pt * 4)))
    except OSError:
        return None


def resolved_family(family: str) -> str | None:
    """Family Fontconfig actually binds, or None when it cannot bind one."""
    resolved, _file_path = _match(family)
    return resolved


def font_substituted(requested: str) -> bool:
    """True when the installed face is not the one the template named."""
    resolved = resolved_family(requested)
    if resolved is None:
        return True
    return requested.casefold() not in resolved.casefold()


class FontBook:
    """Warnings for faces this build measured with a substitute, or could not measure."""

    def __init__(self) -> None:
        self.warnings: list[dict[str, Any]] = []
        self._seen: set[tuple[str, str]] = set()

    def note(self, role: str, requested: str) -> None:
        if not requested or (role, requested) in self._seen:
            return
        if not font_substituted(requested):
            return
        self._seen.add((role, requested))
        self.warnings.append(
            {"role": role, "requested": requested, "resolved": resolved_family(requested)}
        )


def text_width_emu(text: str, family: str, size_pt: float) -> int:
    font = _font(family, size_pt)
    if font is not None:
        return int(font.getlength(text) / 4 * EMU_PER_PT)
    return int(len(text) * size_pt * 0.55 * EMU_PER_PT)


def line_count(text: str, family: str, size_pt: float, width_emu: int) -> int:
    """How many lines `text` takes when it wraps inside `width_emu`."""
    width = max(width_emu, 1)

    def length(value: str) -> int:
        return text_width_emu(value, family, size_pt)

    total = 0
    for paragraph in text.split("\n"):
        line = ""
        total += 1
        for word in paragraph.split():
            candidate = f"{line} {word}".strip()
            if length(candidate) <= width:
                line = candidate
                continue
            if line:
                total += 1
            line = word
            if length(word) > width:
                total += max(0, int(length(word) / width))
    return total


def text_overflow(
    lines: list[str], box: dict[str, int], style: dict[str, Any]
) -> dict[str, int] | None:
    """Lines and EMU that do not fit. None when the copy fits. The copy is not cut."""
    width = max(int(box["cx"]) - INSET_X, 1)
    height = max(int(box["cy"]) - INSET_Y, 0)
    line_height = float(style["sizePt"]) * float(style.get("lineSpacing") or 1) * EMU_PER_PT
    needed = sum(line_count(line, style["font"], float(style["sizePt"]), width) for line in lines)
    available = int(height // line_height) if line_height else 0
    extra = max(0, needed - available)
    if extra <= 0:
        return None
    return {"lines": extra, "emu": int(extra * line_height)}
