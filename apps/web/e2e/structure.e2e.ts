import { expect, test, type Page } from '@playwright/test';
import {
  canvasArea,
  centerOf,
  objectById,
  openEditor,
  openSlide,
  selectionBar,
  thumbnails,
} from './editor';

/** Строки панели слоёв, выбранные сейчас, — по их id видно, что выделено на холсте. */
function selectedLayers(page: Page) {
  return page.locator('[role="tree"] [role="treeitem"][aria-selected="true"]');
}

test.describe('группы, слои и несколько слайдов (F-50, F-51, F-70)', () => {
  test('Ctrl+G собирает группу: щелчок берёт её целиком, двойной — входит внутрь', async ({
    page,
  }) => {
    await openEditor(page);
    await openSlide(page, 'pipeline');
    await page.getByRole('tab', { name: /^(Слои|Layers)$/ }).click();
    const name = objectById(page, 'pipeline-step-1-name');
    const text = objectById(page, 'pipeline-step-1-text');
    await name.click();
    await text.click({ modifiers: ['Shift'] });
    await page.keyboard.press('Control+G');
    await expect(selectionBar(page)).toContainText(/Группа|Group/);

    await page.keyboard.press('Escape');
    await expect(selectionBar(page)).toHaveCount(0);
    await text.click();
    await expect(selectionBar(page)).toContainText(/Группа|Group/);

    // Двойной щелчок входит в группу и выбирает объект под курсором, а не открывает набор.
    // Сверху лежит рамка группы: щёлкаем по точке, как человек, а не по узлу.
    const point = await centerOf(text);
    await page.mouse.dblclick(point.x, point.y);
    await expect(page.locator('[data-text-editor]')).toHaveCount(0);
    await expect(selectedLayers(page)).toHaveCount(1);
    await expect(selectedLayers(page)).toHaveAttribute('data-layer-id', 'pipeline-step-1-text');
    // Внутри группы следующий двойной щелчок — уже набор в самом объекте.
    await page.mouse.dblclick(point.x, point.y);
    await expect(page.locator('[data-text-editor]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-text-editor]')).toHaveCount(0);
    // Внутри группы Esc поднимается на уровень вверх — к группе.
    await page.keyboard.press('Escape');
    await expect(selectionBar(page)).toContainText(/Группа|Group/);

    await page.keyboard.press('Control+Shift+G');
    await page.keyboard.press('Escape');
    await text.click();
    await expect(selectionBar(page)).not.toContainText(/Группа|Group/);
    await expect(canvasArea(page)).toBeFocused();
  });

  test('стрелки в панели слоёв ходят по строкам и не двигают объект', async ({ page }) => {
    await openEditor(page);
    await openSlide(page, 'problem');
    await page.getByRole('tab', { name: /^(Слои|Layers)$/ }).click();
    const title = objectById(page, 'problem-title');
    const before = await title.boundingBox();
    const row = page.locator('[role="treeitem"][data-layer-id="problem-title"]');
    await row.click();
    await expect(row).toBeFocused();
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']) {
      await page.keyboard.press(key);
    }
    const after = await title.boundingBox();
    expect(Math.round(after?.x ?? 0)).toBe(Math.round(before?.x ?? 0));
    expect(Math.round(after?.y ?? 0)).toBe(Math.round(before?.y ?? 0));
    // Tab уводит фокус из дерева, а не перебирает объекты на холсте.
    await page.keyboard.press('Tab');
    await expect(page.locator('[role="tree"] [role="treeitem"]:focus')).toHaveCount(0);
  });

  test('Shift+щелчок выбирает несколько слайдов, Delete удаляет их одной записью', async ({
    page,
  }) => {
    await openEditor(page);
    const total = await thumbnails(page).count();
    await thumbnails(page).nth(1).click();
    await thumbnails(page)
      .nth(3)
      .click({ modifiers: ['Shift'] });
    await expect(page.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true');
    await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(3);

    await page.keyboard.press('Delete');
    await expect(thumbnails(page)).toHaveCount(total - 3);
    await page.keyboard.press('Control+Z');
    await expect(thumbnails(page)).toHaveCount(total);

    // Ctrl+щелчок добавляет слайд к выбору и снимает его.
    await thumbnails(page).nth(0).click();
    await thumbnails(page)
      .nth(5)
      .click({ modifiers: ['Control'] });
    await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(2);
    await thumbnails(page)
      .nth(5)
      .click({ modifiers: ['Control'] });
    await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
  });
});
