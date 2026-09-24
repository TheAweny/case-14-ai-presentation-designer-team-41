import { devices, expect, test } from '@playwright/test';
import { objects, openEditor } from './editor';

// Телефон шириной 390 px с касаниями вместо мыши.
const { defaultBrowserType: _browser, ...phone } = devices['iPhone 13'];
test.use(phone);

test.describe('узкий экран (F-110)', () => {
  test('нижняя панель: вставить фигуру касанием, отменить, повторить, открыть свойства', async ({
    page,
  }) => {
    await openEditor(page);
    const bar = page.locator('[data-mobile-bar]');
    await expect(bar).toBeVisible();

    // Каждая цель — не меньше 44 px.
    const boxes = await bar
      .getByRole('button')
      .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect()));
    for (const box of boxes) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const undo = bar.getByRole('button', { name: /Отменить|Undo/ });
    await expect(undo).toBeDisabled();

    const count = await objects(page).count();
    await bar.getByRole('button', { name: /Вставить|Insert/ }).tap();
    await page.getByRole('menuitem', { name: /Прямоугольник|Rectangle/ }).tap();
    // Инструмент ждёт касания слайда, а меню уже закрылось и не держит страницу.
    await expect(bar.getByRole('status')).toContainText(/Прямоугольник|Rectangle/);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveCSS('pointer-events', 'none');
    const slide = await page.locator('[data-canvas-slide]').boundingBox();
    if (!slide) throw new Error('slide is not on screen');
    await page.touchscreen.tap(slide.x + slide.width / 2, slide.y + slide.height / 2);
    await expect(objects(page)).toHaveCount(count + 1);

    await undo.tap();
    await expect(objects(page)).toHaveCount(count);
    await bar.getByRole('button', { name: /Повторить|Redo/ }).tap();
    await expect(objects(page)).toHaveCount(count + 1);

    await bar.getByRole('button', { name: /Свойства|Properties/ }).tap();
    const sheet = page.locator('[data-slot="sheet-content"]');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('tab', { name: /Дизайн|Design/ })).toBeVisible();
  });
});
