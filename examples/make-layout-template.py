"""Builds examples/layout-template.pptx: the layouts a deck is built on when no template is given.

Only the arrangement lives here: where the title, the copy, a chart, three figures or a picture
go. Every colour is a theme colour and every font a theme font, so a brandbook restyles the whole
file, decorations included; without one the deck is a quiet white and violet-free grey.

The engine reads each slide as one composition: text shapes are its slots, their sample text
says what a slot expects, and a large filled panel with nothing on it is where a picture goes.

    uv run python examples/make-layout-template.py
"""

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.dml import MSO_THEME_COLOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

WIDTH, HEIGHT = Inches(13.333), Inches(7.5)
MARGIN = Inches(0.7)
#: The layout with a title placeholder only: the rest of a slide is drawn here.
TITLE_ONLY = 5


def text(slide, box, sample, size, *, bold=False, accent=False, align=PP_ALIGN.LEFT, top=True):
    """A text slot with its sample: the sample tells the writer what the box is for."""
    shape = slide.shapes.add_textbox(*box)
    frame = shape.text_frame
    frame.word_wrap = True
    frame.vertical_anchor = MSO_ANCHOR.TOP if top else MSO_ANCHOR.MIDDLE
    for side in ("margin_left", "margin_right", "margin_top", "margin_bottom"):
        setattr(frame, side, Emu(0))
    paragraph = frame.paragraphs[0]
    paragraph.alignment = align
    run = paragraph.add_run()
    run.text = sample
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.theme_color = MSO_THEME_COLOR.ACCENT_1 if accent else MSO_THEME_COLOR.TEXT_1
    return shape


def title(slide, sample, size=26, box=None):
    """The slide title placeholder, moved to the 16:9 grid: a brand colours it as a heading."""
    placeholder = slide.shapes.title
    # The top right corner stays free: a brand's logo goes there.
    left, top, width, height = box or (MARGIN, Inches(0.45), Inches(10.6), Inches(1.3))
    placeholder.left, placeholder.top, placeholder.width, placeholder.height = (
        left,
        top,
        width,
        height,
    )
    placeholder.text = sample
    frame = placeholder.text_frame
    frame.vertical_anchor = MSO_ANCHOR.TOP
    for paragraph in frame.paragraphs:
        paragraph.alignment = PP_ALIGN.LEFT
        for run in paragraph.runs:
            run.font.size = Pt(size)
            run.font.bold = True
    return placeholder


def band(slide, box, colour=MSO_THEME_COLOR.ACCENT_1, shape=MSO_SHAPE.RECTANGLE):
    """A decoration in a theme colour: a rule, a bar or a dot."""
    item = slide.shapes.add_shape(shape, *box)
    item.fill.solid()
    item.fill.fore_color.theme_color = colour
    item.line.fill.background()
    return item


def card(slide, box):
    """A light card that copy sits on."""
    item = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, *box)
    item.adjustments[0] = 0.08
    item.fill.solid()
    item.fill.fore_color.rgb = RGBColor(0xF3, 0xF4, 0xF7)
    item.line.fill.background()
    return item


def picture_panel(slide, box):
    """A large filled panel with nothing on it: the engine puts the deck's picture here."""
    item = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, *box)
    item.fill.solid()
    item.fill.fore_color.rgb = RGBColor(0xE9, 0xEA, 0xEE)
    item.line.fill.background()
    return item


def cover(deck):
    slide = deck.slides.add_slide(deck.slide_layouts[TITLE_ONLY])
    picture_panel(slide, (Inches(7.4), 0, WIDTH - Inches(7.4), HEIGHT))
    band(slide, (MARGIN, Inches(1.2), Inches(0.9), Inches(0.08)))
    text(slide, (MARGIN, Inches(1.45), Inches(6.2), Inches(0.4)), "Компания · тема · год", 14)
    title(
        slide,
        "Главная мысль презентации одной фразой",
        34,
        (MARGIN, Inches(2.0), Inches(6.3), Inches(2.6)),
    )
    text(
        slide,
        (MARGIN, Inches(4.8), Inches(6.2), Inches(1.2)),
        "Для кого презентация и какое решение она просит принять",
        18,
    )


def statement(deck):
    slide = deck.slides.add_slide(deck.slide_layouts[TITLE_ONLY])
    band(slide, (MARGIN, Inches(1.4), Inches(0.12), Inches(3.6)))
    title(
        slide,
        "Короткий тезис раздела: что изменилось и почему это важно",
        36,
        (Inches(1.2), Inches(1.4), Inches(10.5), Inches(2.4)),
    )
    text(
        slide,
        (Inches(1.2), Inches(4.0), Inches(10.0), Inches(1.6)),
        "Два предложения пояснения: факт из данных, который подтверждает тезис, и что из него "
        "следует для слушателя.",
        20,
    )


def chart_insight(deck):
    slide = deck.slides.add_slide(deck.slide_layouts[TITLE_ONLY])
    title(slide, "Заголовок-вывод: что показывает график и почему это важно слушателю")
    band(slide, (MARGIN, Inches(1.85), Inches(0.9), Inches(0.06)))
    text(
        slide,
        (MARGIN, Inches(2.15), Inches(7.4), Inches(4.8)),
        "Здесь график или таблица по данным: категории, значения и единицы измерения. "
        "Подписи осей и источник. Если графика нет, здесь три-четыре коротких факта с числами, "
        "каждый со своим смыслом для слушателя.",
        16,
    )
    card(slide, (Inches(8.45), Inches(2.15), Inches(4.2), Inches(4.8)))
    band(slide, (Inches(8.75), Inches(2.45), Inches(0.5), Inches(0.06)))
    text(
        slide,
        (Inches(8.75), Inches(2.75), Inches(3.6), Inches(3.95)),
        "Что из данных следует для слушателя и какое действие это подсказывает: две-три "
        "короткие мысли.",
        16,
    )


def kpis(deck):
    slide = deck.slides.add_slide(deck.slide_layouts[TITLE_ONLY])
    title(slide, "Три цифры, которые решают: что они значат для слушателя")
    band(slide, (MARGIN, Inches(1.85), Inches(0.9), Inches(0.06)))
    width = (WIDTH - 2 * MARGIN - 2 * Inches(0.4)) / 3
    for index, (figure, caption) in enumerate(
        [
            ("42%", "что выросло и за какой срок"),
            ("3×", "во сколько раз лучше прежнего"),
            ("120", "сколько и чего именно"),
        ]
    ):
        left = MARGIN + index * (width + Inches(0.4))
        card(slide, (left, Inches(2.3), width, Inches(3.8)))
        band(slide, (left + Inches(0.35), Inches(2.65), Inches(0.5), Inches(0.06)))
        text(
            slide,
            (left + Inches(0.35), Inches(2.95), width - Inches(0.7), Inches(1.3)),
            figure,
            48,
            bold=True,
            accent=True,
        )
        text(
            slide,
            (left + Inches(0.35), Inches(4.35), width - Inches(0.7), Inches(1.5)),
            caption,
            16,
        )


def picture_text(deck):
    slide = deck.slides.add_slide(deck.slide_layouts[TITLE_ONLY])
    picture_panel(slide, (0, 0, Inches(5.6), HEIGHT))
    title(
        slide,
        "Что это даёт заказчику",
        26,
        (Inches(6.3), Inches(0.9), Inches(6.3), Inches(1.5)),
    )
    band(slide, (Inches(6.3), Inches(2.55), Inches(0.9), Inches(0.06)))
    text(
        slide,
        (Inches(6.3), Inches(2.9), Inches(6.2), Inches(3.8)),
        "Три коротких абзаца о выгоде: что станет лучше, насколько, и чем это подтверждено в "
        "данных. Без чисел, которых нет в материалах.",
        18,
    )


def closing(deck):
    slide = deck.slides.add_slide(deck.slide_layouts[TITLE_ONLY])
    band(slide, (0, Inches(6.9), WIDTH, Inches(0.3)))
    title(
        slide,
        "Следующий шаг: какое решение нужно сейчас",
        36,
        (MARGIN, Inches(1.4), Inches(11.5), Inches(2.0)),
    )
    text(
        slide,
        (MARGIN, Inches(3.6), Inches(11.5), Inches(1.8)),
        "Что предлагаем сделать, в какой срок и что для этого нужно от слушателей.",
        20,
    )


def main() -> None:
    deck = Presentation()
    deck.slide_width, deck.slide_height = WIDTH, HEIGHT
    for build in (cover, statement, chart_insight, kpis, picture_text, closing):
        build(deck)
    out = Path(__file__).with_name("layout-template.pptx")
    deck.core_properties.author = "examples"
    deck.save(out)
    print(out)


if __name__ == "__main__":
    main()
