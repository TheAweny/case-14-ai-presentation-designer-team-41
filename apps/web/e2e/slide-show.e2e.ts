import { expect, test } from '@playwright/test';
import { openEditor, thumbnails } from './editor';

test.describe('показ слайдов (F-120)', () => {
  test('F5 открывает показ с начала на весь экран, стрелки листают, Esc возвращает', async ({
    page,
  }) => {
    await openEditor(page);
    const total = await thumbnails(page).count();
    await thumbnails(page).nth(2).click();
    await page.locator('[data-canvas-area]').click({ position: { x: 4, y: 4 } });

    await page.keyboard.press('F5');
    const show = page.locator('[data-slide-show]');
    const counter = show.locator('[aria-live]');
    await expect(show).toBeFocused();
    await expect(counter).toHaveText(`1 / ${total}`);
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.hasAttribute('data-slide-show')))
      .toBe(true);

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    await expect(counter).toHaveText(`3 / ${total}`);
    await page.keyboard.press('ArrowLeft');
    await expect(counter).toHaveText(`2 / ${total}`);
    await page.mouse.click(200, 200);
    await expect(counter).toHaveText(`3 / ${total}`);

    await page.keyboard.press('Escape');
    await expect(show).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
    // Редактор открыл слайд, на котором остановились.
    await expect(thumbnails(page).nth(2)).toHaveAttribute('aria-selected', 'true');
  });

  test('Shift+F5 и кнопка на рейке начинают с открытого слайда', async ({ page }) => {
    await openEditor(page);
    const total = await thumbnails(page).count();
    await thumbnails(page).nth(4).click();

    await page.keyboard.press('Shift+F5');
    const show = page.locator('[data-slide-show]');
    await expect(show.locator('[aria-live]')).toHaveText(`5 / ${total}`);
    await show.getByRole('button', { name: /Выйти из показа|Exit slideshow/ }).click();
    await expect(show).toHaveCount(0);

    await page
      .getByRole('button', { name: /Показ с текущего слайда|Present from current/ })
      .click();
    await expect(show.locator('[aria-live]')).toHaveText(`5 / ${total}`);
  });

  test('после последнего слайда — экран конца, следующий шаг закрывает показ', async ({ page }) => {
    await openEditor(page);
    await page.locator('[data-canvas-area]').click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('F5');
    const show = page.locator('[data-slide-show]');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');
    await expect(show.locator('[aria-live]')).toHaveText(/Конец показа|End of slideshow/);
    await page.keyboard.press('ArrowRight');
    await expect(show).toHaveCount(0);
  });
});
