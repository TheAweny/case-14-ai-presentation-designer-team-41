import { expect, test } from '@playwright/test';
import { freeObject, objectById, openEditor, thumbnails } from './editor';

test.describe('фокус холста (F-01)', () => {
  test('миниатюра, затем объект: Delete удаляет объект, а не слайд', async ({ page }) => {
    await openEditor(page);
    const count = await thumbnails(page).count();
    await thumbnails(page).nth(1).click();
    const target = freeObject(page);
    const id = await target.getAttribute('data-element-id');
    expect(id).not.toBeNull();

    await target.click();
    await expect(page.locator('[data-canvas-area]')).toBeFocused();
    await page.keyboard.press('Delete');

    await expect(objectById(page, id ?? '')).toHaveCount(0);
    await expect(thumbnails(page)).toHaveCount(count);
  });

  test('после щелчка по холсту стрелка двигает объект, а не листает слайды', async ({ page }) => {
    await openEditor(page);
    await thumbnails(page).nth(1).click();
    const target = freeObject(page);
    await target.click();
    const before = await target.boundingBox();
    await page.keyboard.press('ArrowRight');

    await expect(thumbnails(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(async () => (await target.boundingBox())?.x).toBeGreaterThan(before?.x ?? 0);
  });

  test('щелчок по миниатюре оставляет клавиши списку: Delete удаляет слайд', async ({ page }) => {
    await openEditor(page);
    const count = await thumbnails(page).count();
    await thumbnails(page).nth(1).click();
    await expect(thumbnails(page).nth(1)).toBeFocused();
    await page.keyboard.press('Delete');
    await expect(thumbnails(page)).toHaveCount(count - 1);
  });
});
