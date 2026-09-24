import { expect, type Page } from '@playwright/test';

/** Открыть редактор и дождаться, пока он оживёт: слайд нарисован, обработчики навешены. */
export async function openEditor(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(objects(page).first()).toBeVisible();
  // Значок сервера разработки в углу перехватывает касания: проверкам он не нужен.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
}

/** Миниатюры списка слайдов. */
export function thumbnails(page: Page) {
  return page.getByRole('listbox').getByRole('option');
}

/** Объекты открытого слайда на холсте. */
export function objects(page: Page) {
  return page.locator('[data-canvas-slide] [data-element-id]');
}

/** Первый объект слайда, который можно выделить: оформление шаблона заблокировано. */
export function freeObject(page: Page) {
  return page.locator('[data-canvas-slide] [data-element-id]:not([data-locked="true"])').first();
}

/** Объект по id — чтобы проверить, что правка дошла именно до него. */
export function objectById(page: Page, id: string) {
  return page.locator(`[data-canvas-slide] [data-element-id="${id}"]`);
}
