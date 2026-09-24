import { expect, test } from '@playwright/test';
import { canvasArea, centerOf, drag, objectById, objects, openEditor, openSlide } from './editor';

test.describe('холст и монтажный стол', () => {
  test('средняя кнопка двигает холст, а не объект и не выделение', async ({ page }) => {
    await openEditor(page);
    await openSlide(page, 'problem');
    const slide = page.locator('[data-canvas-slide]');
    const title = objectById(page, 'problem-title');
    await title.click();
    const before = await slide.boundingBox();
    const titleBefore = await title.boundingBox();
    if (!before || !titleBefore) throw new Error('slide is not on screen');

    // Жест начинается прямо на выделенном объекте: средняя кнопка всё равно тащит холст.
    const from = await centerOf(title);
    await drag(page, from, { x: from.x + 80, y: from.y + 50 }, { button: 'middle' });

    const after = await slide.boundingBox();
    expect(after?.x ?? 0).toBeCloseTo(before.x + 80, -1);
    expect(after?.y ?? 0).toBeCloseTo(before.y + 50, -1);
    // Объект уехал вместе с листом, а не относительно него.
    const titleAfter = await title.boundingBox();
    expect((titleAfter?.x ?? 0) - (after?.x ?? 0)).toBeCloseTo(titleBefore.x - before.x, 0);
    // Двойной щелчок по полю возвращает слайд в кадр.
    await canvasArea(page).dblclick({ position: { x: 6, y: 6 } });
    await expect
      .poll(async () => Math.round((await slide.boundingBox())?.x ?? 0))
      .toBe(Math.round(before.x));
  });

  test('объект выносится за край слайда и остаётся там после отмены выделения', async ({
    page,
  }) => {
    await openEditor(page);
    await openSlide(page, 'problem');
    const slide = await page.locator('[data-canvas-slide]').boundingBox();
    const title = objectById(page, 'problem-title');
    await title.click();
    const box = await title.boundingBox();
    if (!slide || !box) throw new Error('slide is not on screen');

    const from = await centerOf(title);
    // Левый край заголовка — на 40 px левее слайда.
    const dx = slide.x - box.x - 40;
    await drag(page, from, { x: from.x + dx, y: from.y });
    await expect.poll(async () => (await title.boundingBox())?.x ?? 0).toBeLessThan(slide.x - 20);

    await page.keyboard.press('Escape');
    await expect.poll(async () => (await title.boundingBox())?.x ?? 0).toBeLessThan(slide.x - 20);
    await page.keyboard.press('Control+Z');
    await expect
      .poll(async () => Math.round((await title.boundingBox())?.x ?? 0))
      .toBe(Math.round(box.x));
  });

  test('Enter и Esc по режимам: инструмент, таблица, выделение', async ({ page }) => {
    await openEditor(page);
    await openSlide(page, 'layer-boundary');
    const count = await objects(page).count();
    const slide = page.locator('[data-canvas-slide]');

    // Esc с инструментом вставки возвращает выбор: щелчок по слайду ничего не рисует.
    await page.keyboard.press('r');
    await page.keyboard.press('Escape');
    await slide.click({ position: { x: 40, y: 40 } });
    await expect(objects(page)).toHaveCount(count);

    // Enter на таблице — правка ячеек, Esc — назад к выделенной таблице, ещё Esc — снять.
    await objectById(page, 'layer-boundary-table').click();
    await page.keyboard.press('Enter');
    const editor = page.locator('[data-table-editor][role="grid"]');
    await expect(editor).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect(canvasArea(page)).toBeFocused();
    await expect(page.locator('[data-selection-bar]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-selection-bar]')).toHaveCount(0);
  });
});
