import { expect, type Locator, type Page } from '@playwright/test';

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

/** Область холста: у неё фокус, когда клавиши про слайд. */
export function canvasArea(page: Page) {
  return page.locator('[data-canvas-area]');
}

/** Полоса свойств над выделением. */
export function selectionBar(page: Page) {
  return page.locator('[data-selection-bar]');
}

/**
 * Открыть слайд демо-колоды по id и отдать клавиатуру холсту. Миниатюра ищется по id, а не по
 * месту: тест не зависит от порядка слайдов.
 */
export async function openSlide(page: Page, slideId: string): Promise<void> {
  await page.locator(`[role="option"][data-slide-id="${slideId}"]`).click();
  await expect(page.locator(`[data-canvas-slide][data-slide-id="${slideId}"]`)).toBeVisible();
  await canvasArea(page).click({ position: { x: 4, y: 4 } });
}

/** Середина объекта на экране — для щелчков и жестов мышью. */
export async function centerOf(target: Locator): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox();
  if (!box) throw new Error('object is not on screen');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Протянуть мышью от точки к точке по шагам, с зажатыми клавишами. */
export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { readonly button?: 'left' | 'middle'; readonly steps?: number } = {},
): Promise<void> {
  const button = options.button ?? 'left';
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(to.x, to.y, { steps: options.steps ?? 12 });
  await page.mouse.up({ button });
}
