import { expect, test, type Locator } from '@playwright/test';
import {
  canvasArea,
  objectById,
  objects,
  openEditor,
  openSlide,
  selectionBar,
  thumbnails,
} from './editor';

function fontWeight(target: Locator) {
  return target.evaluate((node) => {
    const first = document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode();
    return getComputedStyle(first?.parentElement ?? node).fontWeight;
  });
}

test.describe('горячие клавиши (F-08)', () => {
  test('Ctrl+2 открывает второй слайд, Ctrl+B делает выделенный текст жирным', async ({ page }) => {
    await openEditor(page);
    await canvasArea(page).click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('Control+2');
    await expect(thumbnails(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(canvasArea(page)).toBeFocused();

    const target = objectById(page, 'problem-bullets');
    await target.click();
    const before = await fontWeight(target);
    await page.keyboard.press('Control+B');
    await expect.poll(() => fontWeight(target)).not.toBe(before);
    await page.keyboard.press('Control+B');
    await expect.poll(() => fontWeight(target)).toBe(before);
  });

  test('Ctrl+/ открывает шпаргалку; поиск в ней не переключает инструменты', async ({ page }) => {
    await openEditor(page);
    await openSlide(page, 'problem');
    const count = await objects(page).count();
    const zoom = page.locator('[data-canvas-area] [aria-label*="%"]').first();
    const zoomBefore = await zoom.getAttribute('aria-label');
    await page.keyboard.press('Control+/');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const search = dialog.getByRole('searchbox');
    await search.click();
    // R, T, L — буквы инструментов рейки, «?» — сама шпаргалка: в поиске это просто текст.
    await page.keyboard.type('rtl?');
    await expect(search).toHaveValue('rtl?');
    await search.fill('');
    await page.keyboard.type('Ctrl');
    await expect(dialog.locator('dl > div').first()).toBeVisible();
    await expect(dialog.getByText(/Мышь и жесты|Mouse and gestures/)).toBeVisible();
    // Фокус на кнопке окна: буквы и зум всё равно не уходят холсту под окном.
    await dialog.getByRole('button', { name: /^(Закрыть|Close)$/ }).focus();
    await page.keyboard.press('r');
    await page.keyboard.press('Control+Equal');

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(zoom).toHaveAttribute('aria-label', zoomBefore ?? '');
    // Инструмент остался «выбор»: щелчок по слайду ничего не вставляет.
    await page.locator('[data-canvas-slide]').click({ position: { x: 30, y: 30 } });
    await expect(objects(page)).toHaveCount(count);
  });

  test('в заметках и в полях панели клавиши принадлежат полю, а не холсту', async ({ page }) => {
    await openEditor(page);
    await openSlide(page, 'problem');
    const title = objectById(page, 'problem-title');
    await title.click();
    await expect(selectionBar(page)).toBeVisible();
    const weight = await fontWeight(title);

    const notes = page.locator('[data-speaker-notes]');
    const field = notes.getByRole('textbox');
    if ((await field.count()) === 0) {
      await notes.getByRole('button', { name: /Заметки докладчика|Speaker notes/ }).click();
    }
    await field.click();
    await page.keyboard.type('Итоги');
    await page.keyboard.press('Control+B');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Control+A');
    await expect(field).toHaveValue('Итог');
    // Объект на месте и не стал жирным: клавиши ушли в поле.
    await expect(title).toHaveCount(1);
    expect(await fontWeight(title)).toBe(weight);
    await expect(thumbnails(page).nth(1)).toHaveAttribute('aria-selected', 'true');

    // Esc из заметок — обратно к слайду: следующая клавиша снова про выделенный объект.
    await page.keyboard.press('Escape');
    await expect(canvasArea(page)).toBeFocused();
    await page.keyboard.press('Delete');
    await expect(title).toHaveCount(0);
  });
});
