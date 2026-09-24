import { expect, test } from '@playwright/test';
import { canvasArea, objectById, objects, openEditor, openSlide, selectionBar } from './editor';

test.describe('текст (F-20, F-21, F-22, F-02)', () => {
  test('полоса формата не прерывает набор, рамка растёт под текст', async ({ page }) => {
    await openEditor(page);
    await openSlide(page, 'section-solution');
    const count = await objects(page).count();
    const slide = await page.locator('[data-canvas-slide]').boundingBox();
    if (!slide) throw new Error('slide is not on screen');

    await page.keyboard.press('t');
    await page.mouse.click(slide.x + slide.width * 0.1, slide.y + slide.height * 0.1);
    const field = page.locator('[data-text-editor] [contenteditable="true"]');
    await expect(field).toBeFocused();
    await page.keyboard.type('Первая');
    for (const line of ['Вторая', 'Третья', 'Четвёртая', 'Пятая']) {
      await page.keyboard.press('Enter');
      await page.keyboard.type(line);
    }

    const format = page.getByRole('toolbar', { name: /Формат текста|Text format/ });
    await expect(format).toBeVisible();
    // Во время набора полоса выделения не спорит с полосой формата.
    await expect(selectionBar(page)).toHaveCount(0);

    await page.keyboard.press('Control+A');
    await format.getByRole('button', { name: /^(Жирный|Bold)$/ }).click();
    await expect(field).toBeFocused();
    // Самый крупный кегль шаблона: пять строк им заведомо не влезают в прежнюю рамку.
    await format.getByRole('button', { name: /^(Кегли шаблона|Template sizes)$/ }).click();
    await page.getByRole('menuitemradio').first().click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(field).toBeFocused();
    await page.keyboard.press('Escape');

    await expect(objects(page)).toHaveCount(count + 1);
    const created = objects(page).last();
    await expect(created).toContainText('Пятая');
    const frame = await created.boundingBox();
    const last = await created.getByText('Пятая').boundingBox();
    if (!frame || !last) throw new Error('text is not on screen');
    expect(last.y + last.height).toBeLessThanOrEqual(frame.y + frame.height + 2);
    // После набора текст выделен, клавиши — у холста.
    await expect(canvasArea(page)).toBeFocused();
    await expect(selectionBar(page)).toBeVisible();
  });

  test('Tab в списке меняет уровень пункта, а не уводит фокус', async ({ page }) => {
    await openEditor(page);
    await openSlide(page, 'problem');
    await objectById(page, 'problem-bullets').click();
    await page.keyboard.press('Enter');
    const field = page.locator('[data-text-editor] [contenteditable="true"]');
    await expect(field).toBeFocused();
    await page.keyboard.press('Control+End');
    const words = field.locator('p').last().locator('span').first();
    const before = await words.boundingBox();
    await page.keyboard.press('Tab');
    await expect(field).toBeFocused();
    await expect
      .poll(async () => (await words.boundingBox())?.x ?? 0)
      .toBeGreaterThan((before?.x ?? 0) + 4);
    await page.keyboard.press('Shift+Tab');
    await expect
      .poll(async () => Math.round((await words.boundingBox())?.x ?? 0))
      .toBe(Math.round(before?.x ?? 0));
    await page.keyboard.press('Escape');
    await expect(canvasArea(page)).toBeFocused();
  });
});
