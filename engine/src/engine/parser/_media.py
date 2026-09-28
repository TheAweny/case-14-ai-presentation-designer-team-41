"""Reading pictures of a package: what colour a picture reads as from a distance."""

from __future__ import annotations

from io import BytesIO

from PIL import Image, ImageStat, UnidentifiedImageError

#: A picture is averaged at this size at most: enough for a mean colour, cheap on a 4K photo.
_MEAN_COLOR_SIDE = 256


def mean_color(blob: bytes) -> str | None:
    """Mean colour of a raster picture as hex, or None when it is not one Pillow can read."""
    try:
        with Image.open(BytesIO(blob)) as image:
            # JPEG decodes straight at a reduced scale; other formats ignore the hint.
            image.draft("RGB", (_MEAN_COLOR_SIDE, _MEAN_COLOR_SIDE))
            picture = image.convert("RGBA")
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        return None
    picture.thumbnail((_MEAN_COLOR_SIDE, _MEAN_COLOR_SIDE), Image.Resampling.BOX)
    # Where the picture is transparent, the white of an empty slide shows through.
    canvas = Image.new("RGBA", picture.size, (255, 255, 255, 255))
    canvas.alpha_composite(picture)
    red, green, blue = (round(c) for c in ImageStat.Stat(canvas.convert("RGB")).mean)
    return f"{red:02X}{green:02X}{blue:02X}"
