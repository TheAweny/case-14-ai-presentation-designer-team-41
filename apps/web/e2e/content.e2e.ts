import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  canvasArea,
  centerOf,
  drag,
  objectById,
  objects,
  openEditor,
  openSlide,
  selectionBar,
} from './editor';

/** Картинка PNG, нарисованная самим браузером: файл для выбора «с диска». */
async function pngFile(page: Page) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.fillStyle = '#2d6cdf';
    context.fillRect(0, 0, 160, 90);
    context.fillStyle = '#f4b400';
    context.fillRect(40, 20, 80, 50);
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  });
  return { name: 'picture.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') };
}

/** Картинка объекта нарисована: адрес есть и файл декодирован. */
function drawn(page: Page, elementId: string) {
  return page
    .locator(`[data-canvas-slide] [data-element-id="${elementId}"] img`)
    .first()
    .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
}

/** Где картинка лежит в своей рамке: кадр — это её размер и сдвиг, а не адрес файла. */
function pictureFrame(image: Locator) {
  return image
    .locator('img')
    .first()
    .evaluate((img: HTMLImageElement) =>
      [img.style.width, img.style.height, img.style.left, img.style.top].join(' '),
    );
}

test.describe('картинки, заметки и копии (F-12, F-31, F-60)', () => {
  test('картинка с диска: кадрирование, перезагрузка — и кадр, и файл на месте', async ({
    page,
  }) => {
    await openEditor(page);
    await openSlide(page, 'section-solution');
    const count = await objects(page).count();
    const slide = await page.locator('[data-canvas-slide]').boundingBox();
    if (!slide) throw new Error('slide is not on screen');

    await page.keyboard.press('i');
    const chooser = page.waitForEvent('filechooser');
    await page.mouse.click(slide.x + slide.width * 0.6, slide.y + slide.height * 0.15);
    await (await chooser).setFiles(await pngFile(page));
    await expect(objects(page)).toHaveCount(count + 1);
    const id =
      (await page
        .locator('[data-canvas-slide] [data-kind="image"]')
        .last()
        .getAttribute('data-element-id')) ?? '';
    const image = objectById(page, id);
    await expect.poll(() => drawn(page, id)).toBe(true);
    const uncropped = await pictureFrame(image);

    // Двойной щелчок — кадрирование; полоса свойств на это время уходит.
    let point = await centerOf(image);
    await page.mouse.dblclick(point.x, point.y);
    const crop = page.locator('[data-image-crop]');
    await expect(crop).toBeVisible();
    await expect(selectionBar(page)).toHaveCount(0);
    const handle = page.locator('[data-crop-handle="e"]');
    const from = await centerOf(handle);
    await drag(page, from, { x: from.x - 40, y: from.y });
    await page.keyboard.press('Enter');

    await expect(crop).toHaveCount(0);
    await expect.poll(() => pictureFrame(image)).not.toBe(uncropped);
    const cropped = await pictureFrame(image);
    // Кадр применён, картинка снова выделена, клавиши — у холста.
    await expect(canvasArea(page)).toBeFocused();
    await expect(selectionBar(page)).toBeVisible();
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible();

    await page.reload({ waitUntil: 'networkidle' });
    await expect(objectById(page, id)).toHaveCount(1);
    await expect.poll(() => drawn(page, id)).toBe(true);
    await expect.poll(() => pictureFrame(image)).toBe(cropped);

    point = await centerOf(image);
    await page.mouse.dblclick(point.x, point.y);
    await expect(crop).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(crop).toHaveCount(0);
    await expect(canvasArea(page)).toBeFocused();
    await expect.poll(() => pictureFrame(image)).toBe(cropped);
  });

  test('F5 во время кадрирования: кадр закрывается, стрелки листают показ', async ({ page }) => {
    await openEditor(page);
    await openSlide(page, 'section-solution');
    const slide = await page.locator('[data-canvas-slide]').boundingBox();
    if (!slide) throw new Error('slide is not on screen');
    await page.keyboard.press('i');
    const chooser = page.waitForEvent('filechooser');
    await page.mouse.click(slide.x + slide.width * 0.6, slide.y + slide.height * 0.15);
    await (await chooser).setFiles(await pngFile(page));
    const image = page.locator('[data-canvas-slide] [data-kind="image"]').last();
    await expect(image.locator('img')).toBeVisible();
    const point = await centerOf(image);
    await page.mouse.dblclick(point.x, point.y);
    const crop = page.locator('[data-image-crop]');
    await expect(crop).toBeVisible();

    await page.keyboard.press('F5');
    const show = page.locator('[data-slide-show]');
    const counter = show.locator('[aria-live]');
    await expect(counter).toHaveText(/^1 \//);
    await expect(crop).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await expect(counter).toHaveText(/^2 \//);
    await page.keyboard.press('Escape');
    await expect(show).toHaveCount(0);
  });

  test('заметки: значок у миниатюры, в показе их нет', async ({ page }) => {
    await openEditor(page);
    await openSlide(page, 'problem');
    const thumb = page.locator('[role="option"][data-slide-id="problem"]');
    await expect(thumb).not.toHaveAttribute('data-has-notes', '');

    const notes = page.locator('[data-speaker-notes]');
    const field = notes.getByRole('textbox');
    if ((await field.count()) === 0) {
      await notes.getByRole('button', { name: /Заметки докладчика|Speaker notes/ }).click();
    }
    await field.fill('Сказать про часы ручной работы');
    await canvasArea(page).click({ position: { x: 4, y: 4 } });
    await expect(thumb).toHaveAttribute('data-has-notes', '');
    await expect(thumb.locator('[data-notes-mark]')).toBeVisible();

    await page.keyboard.press('Shift+F5');
    const show = page.locator('[data-slide-show]');
    await expect(show).toBeVisible();
    await expect(show).not.toContainText('Сказать про часы');
    await page.keyboard.press('Escape');
    await expect(show).toHaveCount(0);

    // Пустые заметки значка не дают.
    await field.fill('   ');
    await canvasArea(page).click({ position: { x: 4, y: 4 } });
    await expect(thumb).not.toHaveAttribute('data-has-notes', '');
  });

  test('текст в фигуре: набор с клавиатуры, типографика и якорь из правой панели', async ({
    page,
  }) => {
    await openEditor(page);
    await openSlide(page, 'section-solution');
    const count = await objects(page).count();
    const slide = await page.locator('[data-canvas-slide]').boundingBox();
    if (!slide) throw new Error('slide is not on screen');

    await page.keyboard.press('r');
    await drag(
      page,
      { x: slide.x + slide.width * 0.55, y: slide.y + slide.height * 0.1 },
      { x: slide.x + slide.width * 0.9, y: slide.y + slide.height * 0.45 },
    );
    await expect(objects(page)).toHaveCount(count + 1);
    const shape = objects(page).last();
    // Печать на выделенной фигуре начинает набор в ней. «S» — ещё и буква инструмента рейки:
    // при выделенной фигуре она уступает набору.
    await page.keyboard.type('Step');
    await expect(page.locator('[data-text-editor]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(shape).toContainText('Step');

    const typography = page.getByRole('radiogroup', {
      name: /^(Вертикальное выравнивание|Vertical alignment)$/,
    });
    await expect(typography).toBeVisible();
    // Панель показывает текст фигуры таким, какой он на слайде: по центру.
    await expect(
      page
        .getByRole('radiogroup', { name: /^(Выравнивание текста|Text alignment)$/ })
        .getByRole('radio', { checked: true }),
    ).toHaveAccessibleName(/^(По центру|Align centre)$/);
    const words = shape.getByText('Step');
    const middle = await words.boundingBox();
    await typography.getByRole('radio', { name: /^(По верху|Top)$/ }).click();
    await expect
      .poll(async () => (await words.boundingBox())?.y ?? 0)
      .toBeLessThan((middle?.y ?? 0) - 10);

    const size = page.getByRole('textbox', { name: /^(Кегль|Font size)$/ }).first();
    const sizeBefore = await words.evaluate((node) => getComputedStyle(node).fontSize);
    await size.fill('40');
    await size.press('Enter');
    await expect
      .poll(() => words.evaluate((node) => getComputedStyle(node).fontSize))
      .not.toBe(sizeBefore);
  });

  test('Alt+перетаскивание оставляет оригинал и кладёт копию одной записью', async ({ page }) => {
    await openEditor(page);
    await openSlide(page, 'problem');
    const count = await objects(page).count();
    const title = objectById(page, 'problem-title');
    await title.click();
    const box = await title.boundingBox();
    const from = await centerOf(title);
    await page.keyboard.down('Alt');
    await drag(page, from, { x: from.x, y: from.y + 80 });
    await page.keyboard.up('Alt');

    await expect(objects(page)).toHaveCount(count + 1);
    const after = await title.boundingBox();
    expect(Math.round(after?.y ?? 0)).toBe(Math.round(box?.y ?? 0));
    await page.keyboard.press('Control+Z');
    await expect(objects(page)).toHaveCount(count);
  });
});
