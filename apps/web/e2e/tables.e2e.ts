import { expect, test } from '@playwright/test';
import { canvasArea, drag, objectById, openEditor, openSlide, selectionBar } from './editor';

const TABLE = 'layer-boundary-table';

test.describe('таблицы (F-82)', () => {
  test('ввод в ячейку, Tab — в соседнюю, Esc закрывает правку и отдаёт клавиши холсту', async ({
    page,
  }) => {
    await openEditor(page);
    await openSlide(page, 'layer-boundary');
    const table = objectById(page, TABLE);
    const firstBody = table.locator('tr').nth(1).locator('td').first();
    await firstBody.dblclick();

    const editor = page.locator('[data-table-editor][role="grid"]');
    await expect(editor).toBeVisible();
    // Во время правки ячеек полоса свойств только мешала бы: у ячеек своё меню и панель.
    await expect(selectionBar(page)).toHaveCount(0);

    const cell = editor.locator('[data-cell="1:0"]');
    await expect(cell).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Импорт');
    await page.keyboard.press('Tab');
    await expect(editor.locator('[data-cell="1:1"]')).toBeFocused();
    await page.keyboard.type('Где угодно');
    await page.keyboard.press('Escape');

    await expect(editor).toHaveCount(0);
    await expect(table.locator('tr').nth(1).locator('td').nth(0)).toHaveText('Импорт');
    await expect(table.locator('tr').nth(1).locator('td').nth(1)).toHaveText(/Где угодно/);
    // Клавиатура вернулась холсту: Esc ещё раз снимает выделение с таблицы.
    await expect(canvasArea(page)).toBeFocused();
    await expect(selectionBar(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(selectionBar(page)).toHaveCount(0);
  });

  test('граница столбца тянется мышью, одна запись в журнале', async ({ page }) => {
    await openEditor(page);
    await openSlide(page, 'layer-boundary');
    const table = objectById(page, TABLE);
    await table.click();
    const header = table.locator('tr').first().locator('td');
    const before = await header.first().boundingBox();
    const border = page.getByRole('separator', { name: /^(Граница столбца 1|Column 1 border)$/ });
    await expect(border).toBeVisible();
    const handle = await border.boundingBox();
    if (!before || !handle) throw new Error('table is not on screen');

    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await drag(page, { x, y }, { x: x + 60, y });
    await expect
      .poll(async () => (await header.first().boundingBox())?.width ?? 0)
      .toBeGreaterThan(before.width + 30);

    await page.keyboard.press('Control+Z');
    await expect
      .poll(async () => Math.round((await header.first().boundingBox())?.width ?? 0))
      .toBe(Math.round(before.width));
  });

  test('строка перекрашивается из меню ячеек', async ({ page }) => {
    await openEditor(page);
    await openSlide(page, 'layer-boundary');
    const table = objectById(page, TABLE);
    const row = table.locator('tr').nth(2);
    const before = await row
      .locator('td')
      .first()
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    await row.locator('td').first().dblclick();

    const editor = page.locator('[data-table-editor][role="grid"]');
    const first = editor.locator('[data-cell="2:0"]');
    const last = editor.locator('[data-cell="2:3"]');
    await first.click();
    await last.click({ modifiers: ['Shift'] });
    await last.click({ button: 'right' });
    await page
      .getByRole('menuitem', { name: /^Акцент$|^Accent$/ })
      .first()
      .click();
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);

    const cells = row.locator('td');
    for (const index of [0, 3]) {
      await expect
        .poll(() => cells.nth(index).evaluate((node) => getComputedStyle(node).backgroundColor))
        .not.toBe(before);
    }
  });
});
