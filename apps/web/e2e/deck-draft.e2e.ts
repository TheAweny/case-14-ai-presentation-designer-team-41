import { expect, test, type Page } from '@playwright/test';
import { editorReady, freeObject, objectById, openEditor } from './editor';

/** Попросить у страницы `beforeunload` и узнать, стал бы браузер переспрашивать. */
function wouldWarn(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

test.describe('черновик колоды (F-90)', () => {
  test('правка переживает перезагрузку, а «Отменить» возвращает исходную колоду', async ({
    page,
  }) => {
    await openEditor(page);
    const target = freeObject(page);
    const id = (await target.getAttribute('data-element-id')) ?? '';
    await target.click();
    await page.keyboard.press('Delete');
    await expect(objectById(page, id)).toHaveCount(0);
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible();

    await page.reload({ waitUntil: 'networkidle' });
    await editorReady(page);
    const notice = page.locator('[data-draft-restored]');
    await expect(notice).toBeVisible();
    await expect(objectById(page, id)).toHaveCount(0);

    await notice.getByRole('button', { name: /Отменить|Undo/ }).click();
    await expect(objectById(page, id)).toHaveCount(1);
    await expect(notice).toHaveCount(0);

    await page.reload({ waitUntil: 'networkidle' });
    await editorReady(page);
    await expect(objectById(page, id)).toHaveCount(1);
    await expect(page.locator('[data-draft-restored]')).toHaveCount(0);
  });

  test('черновик читается до первого кадра: исходная колода не мелькает', async ({ page }) => {
    await openEditor(page);
    const target = freeObject(page);
    const id = (await target.getAttribute('data-element-id')) ?? '';
    await target.click();
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible();

    // Сторож с самого начала загрузки: появлялся ли удалённый объект на холсте хоть на кадр.
    await page.addInitScript((elementId) => {
      const flags = window as unknown as { __flashed?: boolean };
      flags.__flashed = false;
      new MutationObserver(() => {
        if (document.querySelector(`[data-canvas-slide] [data-element-id="${elementId}"]`)) {
          flags.__flashed = true;
        }
      }).observe(document, { childList: true, subtree: true });
    }, id);
    await page.reload({ waitUntil: 'networkidle' });
    await editorReady(page);
    await expect(page.locator('[data-draft-restored]')).toBeVisible();
    await expect(objectById(page, id)).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { __flashed?: boolean }).__flashed),
    ).toBe(false);

    // Плашка восстановления не мешает первому жесту: объект выделяется и удаляется как обычно.
    const next = freeObject(page);
    const nextId = (await next.getAttribute('data-element-id')) ?? '';
    await next.click();
    await page.keyboard.press('Delete');
    await expect(objectById(page, nextId)).toHaveCount(0);
  });

  test('браузер переспрашивает об уходе, только пока правка не записана', async ({ page }) => {
    await openEditor(page);
    expect(await wouldWarn(page)).toBe(false);
    await freeObject(page).click();
    await page.keyboard.press('Delete');
    expect(await wouldWarn(page)).toBe(true);
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible();
    expect(await wouldWarn(page)).toBe(false);
  });

  test('битый черновик пропускается: колода открывается как есть', async ({ page }) => {
    await openEditor(page);
    const count = await page.locator('[data-canvas-slide] [data-element-id]').count();
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('lct-editor');
          open.onupgradeneeded = () => open.result.createObjectStore('drafts');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction('drafts', 'readwrite');
            tx.objectStore('drafts').put(
              { version: 1, deckId: 'demo', base: 'x', slides: 'broken' },
              'draft:demo',
            );
            tx.oncomplete = () => {
              open.result.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
    await page.reload({ waitUntil: 'networkidle' });
    await editorReady(page);
    await expect(page.locator('[data-canvas-slide] [data-element-id]')).toHaveCount(count);
    await expect(page.locator('[data-draft-restored]')).toHaveCount(0);
  });
});
