"""Render captured ANSI terminal frames as readable PNG documentation images.

Run with uv run --no-project --with pillow --with pyte scripts/docs/render-cli.py DIR
"""

import re
import sys
from pathlib import Path

import pyte
from PIL import Image, ImageDraw, ImageFont

folder = Path(sys.argv[1])
font_candidates = [
    Path("C:/Windows/Fonts/DejaVuSansMono.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"),
]
font_path = next(path for path in font_candidates if path.exists())
font = ImageFont.truetype(str(font_path), 20)
cell_width = font.getlength("M")
line_height = 30
ansi_colors = {
    "default": "#dfdfdf",
    "black": "#282828",
    "red": "#dc7777",
    "green": "#a1bd8c",
    "brown": "#d9ba7d",
    "blue": "#929fb5",
    "magenta": "#b8a2c8",
    "cyan": "#9cbbbb",
    "white": "#dedede",
    "brightblack": "#8c8c8c",
    "brightwhite": "#f0f0f0",
}
for source in sorted(folder.glob("*.ansi")):
    screen = pyte.Screen(96, 70)
    transcript = source.read_bytes().decode("utf-8")
    pyte.Stream(screen).feed(re.sub(r"(?<!\r)\n", "\r\n", transcript))
    last = max((i for i, line in enumerate(screen.display) if line.strip()), default=0)
    first = 0
    if source.stem == "summary":
        first = next(i for i, line in enumerate(screen.display) if "Параметры установки" in line)
    image = Image.new(
        "RGB", (round(96 * cell_width + 64), (last - first + 1) * line_height + 100), "#141414"
    )
    draw = ImageDraw.Draw(image)
    draw.text((32, 17), "LCT / " + source.stem, font=font, fill="#909090")
    draw.line((32, 53, image.width - 32, 53), fill="#323232")
    for row in range(first, last + 1):
        for column, char in screen.buffer[row].items():
            if not char.data.strip():
                continue
            color = ansi_colors.get(char.fg, "#" + char.fg if len(char.fg) == 6 else "#dfdfdf")
            draw.text(
                (32 + column * cell_width, 70 + (row - first) * line_height),
                char.data,
                font=font,
                fill=color,
            )
    image.save(source.with_suffix(".png"), optimize=True)
    print(f"{source.stem}: {image.width}x{image.height}")
