import { expect, test, type Locator } from '@playwright/test';
import { objectById, openEditor, openSlide, selectionBar } from './editor';

const TITLE = 'problem-title';

/** Вычисленный стиль первого текстового узла объекта: так рисует его рендерер. */
function textStyle(target: Locator, property: 'fontSize' | 'color') {
  return target.evaluate((node, name) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode();
    const host = first?.parentElement ?? node;
    return getComputedStyle(host)[name];
  }, property);
}

test.describe('полоса свойств (F-40)', () => {
  test('кегль из меню шаблона и цвет из палитры меняют выделенный текст', async ({ page }) => {
    await openEditor(page);
    await openSlide(page, 'problem');
    const title = objectById(page, TITLE);
    await title.click();
    const bar = selectionBar(page);
    await expect(bar).toBeVisible();

    const sizeBefore = await textStyle(title, 'fontSize');
    await bar.getByRole('button', { name: /^(Кегли шаблона|Template sizes)$/ }).click();
    const sizes = page.getByRole('menuitemradio');
    await expect(sizes.first()).toBeVisible();
    // Самый мелкий кегль шаблона — заведомо не тот, что у заголовка.
    await sizes.last().click();
    await expect.poll(() => textStyle(title, 'fontSize')).not.toBe(sizeBefore);
    await expect(page.getByRole('menu')).toHaveCount(0);

    const colorBefore = await textStyle(title, 'color');
    await bar.getByRole('button', { name: /^(Цвет текста|Text colou?r)$/ }).click();
    const swatches = page.getByRole('radiogroup', { name: /Цвета шаблона|Template colou?rs/ });
    await expect(swatches).toBeVisible();
    await swatches.getByRole('radio', { name: /^(Акцент|Accent)$/ }).click();
    await expect.poll(() => textStyle(title, 'color')).not.toBe(colorBefore);

    // Правки из полосы — обычные записи журнала: две отмены возвращают заголовок.
    await page.keyboard.press('Escape');
    await title.click();
    await page.keyboard.press('Control+Z');
    await page.keyboard.press('Control+Z');
    await expect.poll(() => textStyle(title, 'fontSize')).toBe(sizeBefore);
    await expect.poll(() => textStyle(title, 'color')).toBe(colorBefore);
  });
});
