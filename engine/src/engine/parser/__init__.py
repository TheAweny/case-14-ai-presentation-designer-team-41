"""Parser layer: turns an uploaded .pptx into a draft template profile.

The parser reads a template as a set of rules — palette, type scale, grid, master layouts,
recurring shape patterns — so the rest of the engine can rebuild a deck in that style. Nothing
here may branch on a specific template: every value comes out of the file.

Two properties are load-bearing and easy to lose, so they are stated here rather than left to the
reader. Parsing is **deterministic**: the same file yields the same intermediate representation
and the same ``hash``, which is what makes a cached profile safe to reuse and a regression visible
in a diff. And parsing is **total**: a template that carries something we do not model produces a
warning next to the rest of the result, never a silent gap and never a traceback.
"""

from __future__ import annotations

import hashlib
import json
import zipfile
from collections.abc import Iterable
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image, UnidentifiedImageError
from pptx import Presentation
from pptx.exc import PackageNotFoundError
from pptx.opc.constants import RELATIONSHIP_TYPE as RT

from engine.contracts import DesignSystem
from engine.contracts.provisional import TemplateProfileDraft
from engine.parser._design import build_design_system
from engine.parser._errors import (
    MalformedPresentationError,
    NotAPackageError,
    NotAPresentationError,
    TemplateParseError,
)
from engine.parser._model import (
    EMU_PER_INCH,
    EMU_PER_PT,
    TEMPLATE_IR_SCHEMA_VERSION,
    MediaItem,
    ParseWarning,
    SlideLike,
    TemplateIR,
    WarningCode,
)
from engine.parser._shapes import collect_shapes
from engine.parser._style import background_of, color_map_of
from engine.parser._theme import read_themes

__all__ = [
    "EMU_PER_INCH",
    "EMU_PER_PT",
    "TEMPLATE_IR_SCHEMA_VERSION",
    "MalformedPresentationError",
    "NotAPackageError",
    "NotAPresentationError",
    "TemplateIR",
    "TemplateParseError",
    "design_system_of",
    "parse_template",
    "parse_template_ir",
]

_MEDIA_PREFIX = "ppt/media/"


def _open_package(path: Path) -> zipfile.ZipFile:
    """Open the upload as a zip container, or fail with a sentence rather than a stack."""
    try:
        return zipfile.ZipFile(path)
    except FileNotFoundError as exc:
        raise NotAPackageError(f"file not found: {path}", source_name=path.name) from exc
    except (zipfile.BadZipFile, OSError) as exc:
        raise NotAPackageError(
            f"file is not a readable OOXML package: {exc}", source_name=path.name
        ) from exc


def _require_presentation_parts(archive: zipfile.ZipFile, source_name: str) -> None:
    """Fail early, and with the right name, when the package is not a presentation.

    Without this, a zip of holiday photos reaches python-pptx and comes back as a ``KeyError``
    about ``[Content_Types].xml``, which is true but tells the user nothing.
    """
    names = set(archive.namelist())
    if "[Content_Types].xml" not in names:
        raise NotAPackageError(
            "package has no content types part; it is not an Office document",
            source_name=source_name,
        )
    if "ppt/presentation.xml" not in names:
        raise NotAPresentationError(
            "package is an Office document but holds no presentation",
            source_name=source_name,
        )


def _open_presentation(path: Path) -> Any:
    """Open the upload with python-pptx, mapping its failures onto our own."""
    try:
        return Presentation(str(path))
    except PackageNotFoundError as exc:
        raise NotAPresentationError(
            f"package holds no presentation: {exc}", source_name=path.name
        ) from exc
    except Exception as exc:
        # Deliberately broad. Everything below here is third-party XML handling, and the one
        # promise this layer makes is that a bad upload comes back as a sentence rather than as
        # somebody else's traceback. A narrower clause would let the next unfamiliar parser
        # error through, which is exactly the failure we are guarding against.
        raise MalformedPresentationError(
            f"presentation part cannot be interpreted: {exc}", source_name=path.name
        ) from exc


def _read_media(
    archive: zipfile.ZipFile, warnings: list[ParseWarning]
) -> tuple[tuple[MediaItem, ...], dict[str, str]]:
    """Inventory ``ppt/media`` and map each digest to its part name.

    The digest map is what lets a picture shape name the part it draws without reaching into
    python-pptx internals for the relationship id.
    """
    items: list[MediaItem] = []
    by_digest: dict[str, str] = {}

    for name in sorted(n for n in archive.namelist() if n.startswith(_MEDIA_PREFIX)):
        try:
            blob = archive.read(name)
        except (KeyError, zipfile.BadZipFile, OSError) as exc:
            warnings.append(
                ParseWarning(
                    code=WarningCode.UNREADABLE_MEDIA,
                    message=f"media part cannot be read: {exc}",
                    location=name,
                )
            )
            continue

        by_digest.setdefault(hashlib.sha1(blob).hexdigest(), name)

        width: int | None = None
        height: int | None = None
        try:
            with Image.open(BytesIO(blob)) as image:
                width, height = image.size
        except (UnidentifiedImageError, OSError, ValueError):
            # Vector and media parts are not raster images; their absence of pixel size is
            # expected and does not deserve a warning.
            pass

        items.append(
            MediaItem(
                part=name,
                content_type=Path(name).suffix.lstrip(".").lower(),
                bytes=len(blob),
                width_px=width,
                height_px=height,
            )
        )

    return tuple(items), by_digest


def _slide_likes(
    presentation: Any, warnings: list[ParseWarning], by_digest: dict[str, str]
) -> tuple[tuple[SlideLike, ...], tuple[SlideLike, ...], tuple[SlideLike, ...]]:
    """Walk masters, layouts and slides, in that order of inheritance."""
    masters: list[SlideLike] = []
    layouts: list[SlideLike] = []
    slides: list[SlideLike] = []

    for master in presentation.slide_masters:
        master_part = str(master.part.partname)
        masters.append(
            SlideLike(
                part=master_part,
                name=str(getattr(master, "name", "") or ""),
                shapes=collect_shapes(master.shapes, master_part, warnings, by_digest),
                background=background_of(master._element),
                theme=_theme_part_of(master),
                color_map=color_map_of(master._element),
            )
        )
        for layout in master.slide_layouts:
            layout_part = str(layout.part.partname)
            layouts.append(
                SlideLike(
                    part=layout_part,
                    name=str(getattr(layout, "name", "") or ""),
                    follows=master_part,
                    shapes=collect_shapes(layout.shapes, layout_part, warnings, by_digest),
                    background=background_of(layout._element),
                    color_map=color_map_of(layout._element),
                )
            )

    for index, slide in enumerate(presentation.slides):
        slide_part = str(slide.part.partname)
        try:
            follows = str(slide.slide_layout.part.partname)
        except (AttributeError, KeyError):
            follows = ""
            warnings.append(
                ParseWarning(
                    code=WarningCode.NO_SLIDE_LAYOUT,
                    message="slide follows no layout; its inherited values are unknown",
                    location=slide_part,
                )
            )
        slides.append(
            SlideLike(
                part=slide_part,
                name=f"slide{index + 1}",
                follows=follows,
                shapes=collect_shapes(slide.shapes, slide_part, warnings, by_digest),
                background=background_of(slide._element),
                color_map=color_map_of(slide._element),
            )
        )

    return tuple(masters), tuple(layouts), tuple(slides)


def _theme_part_of(master: Any) -> str:
    """Name of the theme part a master draws its colours and fonts from.

    A package with two masters can carry two themes, and a scheme reference like accent1 means a
    different colour under each. Recording the link is what lets the design-system layer resolve
    every reference against the theme it was written for.
    """
    try:
        return str(master.part.part_related_by(RT.THEME).partname)
    except (KeyError, AttributeError):
        return ""


def parse_template_ir(template_path: Path) -> TemplateIR:
    """Read a .pptx template into the typed intermediate representation.

    Args:
        template_path: Path to the template uploaded by the user.

    Returns:
        The intermediate representation, including any warnings raised along the way.

    Raises:
        TemplateParseError: The file is not a template we can read at all.
    """
    path = Path(template_path)
    warnings: list[ParseWarning] = []

    with _open_package(path) as archive:
        _require_presentation_parts(archive, path.name)
        media, by_digest = _read_media(archive, warnings)
        theme_colors, theme_fonts, theme_warnings = read_themes(archive)
    warnings.extend(theme_warnings)

    presentation = _open_presentation(path)
    slide_cx = int(presentation.slide_width or 0)
    slide_cy = int(presentation.slide_height or 0)
    if slide_cx <= 0 or slide_cy <= 0:
        raise MalformedPresentationError(
            "presentation declares no usable slide size", source_name=path.name
        )

    masters, layouts, slides = _slide_likes(presentation, warnings, by_digest)

    return TemplateIR(
        source_name=path.name,
        slide_cx=slide_cx,
        slide_cy=slide_cy,
        theme_colors=theme_colors,
        theme_fonts=theme_fonts,
        masters=masters,
        layouts=layouts,
        slides=slides,
        media=media,
        warnings=tuple(warnings),
    )


def ir_hash(ir: TemplateIR) -> str:
    """Stable digest of an intermediate representation.

    Computed over canonical JSON so that two runs over the same file, and two machines, agree.
    The source file name is left out on purpose: the same template saved under another name is
    the same template.
    """
    payload = ir.to_dict()
    payload.pop("sourceName", None)
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def parse_template(template_path: Path) -> TemplateProfileDraft:
    """Read a .pptx template and return a draft profile describing its design system.

    Args:
        template_path: Path to the template uploaded by the user.

    Returns:
        A draft profile: colors, fonts, type scale, grid, layouts and shape patterns.
    """
    ir = parse_template_ir(Path(template_path))
    return ir.to_dict() | {"hash": ir_hash(ir)}


def design_system_of(
    template_path: Path, available_fonts: Iterable[str] | None = None
) -> dict[str, Any]:
    """Read a template and derive the design system a layout should follow.

    The payload is validated against the generated ``DesignSystem`` model before it is returned,
    so a drift between this code and the shared contract fails here rather than in whoever reads
    the result.

    Args:
        template_path: Path to the template uploaded by the user.
        available_fonts: Fonts the renderer can draw. When given, fonts outside it are replaced
            and the substitution is reported in ``warnings``.

    Returns:
        A payload matching the shared ``DesignSystem`` contract.
    """
    ir = parse_template_ir(Path(template_path))
    payload = build_design_system(ir, ir_hash(ir), available_fonts)
    DesignSystem.model_validate(payload)
    return payload
