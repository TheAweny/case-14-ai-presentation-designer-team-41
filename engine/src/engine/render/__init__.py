"""Render layer: rasterises a presentation to PNG with LibreOffice.

Renders feed the visual part of the audit and the preview in the web client. LibreOffice is
called as an external process; the fonts available to it must be installed in the image or
host. I reject absent selected families instead of claiming a faithful fallback render.
"""

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from xml.sax.saxutils import escape

__all__ = ["render_to_png"]


def require_fonts(families: set[str]) -> None:
    """I reject missing families rather than silently substituting template typography."""
    missing = []
    for family in sorted(families):
        if not family:
            continue
        result = subprocess.run(
            ["fc-match", "-f", "%{family}", family],
            capture_output=True,
            text=True,
            check=True,
            timeout=3,
        )
        if family.casefold() not in {name.strip().casefold() for name in result.stdout.split(",")}:
            missing.append(family)
    if missing:
        raise ValueError(
            f"Install the original template fonts before rendering: {', '.join(missing)}"
        )


def render_to_png(
    pptx_path: Path,
    output_dir: Path,
    dpi: int = 144,
    *,
    first_slide_only: bool = False,
    timeout_seconds: float | None = None,
) -> list[Path]:
    """Render every slide of a presentation to a PNG file.

    Args:
        pptx_path: Presentation to render.
        output_dir: Directory that receives the images.
        dpi: Raster resolution.
        first_slide_only: Export and rasterise only the cover for template thumbnails.
        timeout_seconds: Optional shared subprocess deadline, not a budget per command.

    Returns:
        Paths of the rendered images, one per slide, in slide order.
    """
    if not pptx_path.is_file():
        raise FileNotFoundError(pptx_path)
    deadline = time.monotonic() + timeout_seconds if timeout_seconds is not None else None

    def remaining_timeout() -> float:
        if deadline is None or timeout_seconds is None:
            return 120
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise subprocess.TimeoutExpired("template-preview", timeout_seconds)
        return min(120, remaining)

    pdf_filter = "pdf"
    if first_slide_only:
        pdf_filter = (
            'pdf:impress_pdf_Export:{"PageRange":{"type":"string","value":"1"},'
            '"ExportHiddenSlides":{"type":"boolean","value":"true"}}'
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    # I stage beside the output so atomic publication also works on Docker bind mounts.
    with tempfile.TemporaryDirectory(prefix="deck-render-", dir=output_dir.resolve()) as workspace:
        temp = Path(workspace)
        profile = (temp / "office-profile").as_uri()
        environment = os.environ.copy()
        if sys.platform == "darwin" and not environment.get("FONTCONFIG_FILE"):
            config = temp / "fonts.conf"
            folders = [
                Path("/System/Library/Fonts"),
                Path("/Library/Fonts"),
                Path.home() / "Library/Fonts",
            ]
            directories = "".join(f"<dir>{escape(str(p))}</dir>" for p in folders)
            config.write_text(
                f"<?xml version='1.0'?><fontconfig>{directories}"
                f"<cachedir>{escape(str(temp / 'fontcache'))}</cachedir></fontconfig>"
            )
            environment["FONTCONFIG_FILE"] = str(config)
        subprocess.run(
            [
                "soffice",
                f"-env:UserInstallation={profile}",
                "--headless",
                "--convert-to",
                pdf_filter,
                "--outdir",
                str(temp),
                str(pptx_path.resolve()),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=remaining_timeout(),
            env=environment,
        )
        pdf_path = temp / f"{pptx_path.stem}.pdf"
        if not pdf_path.is_file() or pdf_path.stat().st_size == 0:
            raise ValueError("LibreOffice did not produce a PDF.")
        subprocess.run(
            [
                "pdftoppm",
                "-png",
                "-r",
                str(dpi),
                *(["-f", "1", "-l", "1"] if first_slide_only else []),
                str(pdf_path),
                str(temp / "slide"),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=remaining_timeout(),
        )
        images = list(temp.glob("slide-*.png"))
        if not images:
            raise ValueError("PDF renderer did not produce slide previews.")
        for stale in output_dir.glob("slide-*.png"):
            stale.unlink()
        for artifact in [pdf_path, *images]:
            artifact.replace(output_dir / artifact.name)

    return sorted(output_dir.glob("slide-*.png"), key=lambda p: int(p.stem.rsplit("-", 1)[1]))
