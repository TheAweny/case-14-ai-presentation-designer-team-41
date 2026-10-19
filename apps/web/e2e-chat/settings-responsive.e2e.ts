import { expect, test, type Locator } from '@playwright/test';
import { sessionCookie } from './session';

test.use({ hasTouch: true });

test.beforeEach(async ({ page, request, baseURL }) => {
  if (!baseURL) throw new Error('Settings tests require the authenticated fixture.');
  await request.post('http://127.0.0.1:3121/__reset-models');
  const value = await sessionCookie('chat-e2e-user');
  await page.context().addCookies([
    { name: 'lct_session', value, url: baseURL },
    { name: 'NEXT_LOCALE', value: 'ru', url: baseURL },
  ]);
});

async function panelFits(dialog: Locator) {
  // The document can fit while overflow:hidden clips an oversized settings tree.
  await expect
    .poll(() =>
      dialog.evaluate((root) => {
        const bounds = root.getBoundingClientRect();
        const panel = root.querySelector<HTMLElement>('[role="tabpanel"][data-state="active"]');
        const title = root.querySelector('[data-slot="dialog-title"]')?.getBoundingClientRect();
        return {
          dialogFits:
            bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight,
          titleFits: !!title && title.left >= bounds.left && title.right <= bounds.right,
          noHorizontalScroll: root.scrollWidth <= root.clientWidth + 1,
          panelFits: !!panel && panel.scrollWidth <= panel.clientWidth + 1,
          noHorizontalShift: root.scrollLeft === 0 && panel?.scrollLeft === 0,
        };
      }),
    )
    .toEqual({
      dialogFits: true,
      titleFits: true,
      noHorizontalScroll: true,
      panelFits: true,
      noHorizontalShift: true,
    });
}

test('settings content fits inside the mobile dialog without being clipped', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const section of ['models', 'decks']) {
    await page.goto(`/?settings=${section}`);
    const dialog = page.getByRole('dialog', { name: 'Настройки', exact: true });
    await expect(dialog.getByRole('heading', { level: 2 }).last()).toBeVisible();
    await panelFits(dialog);
  }
});

const sections = [
  ['account', 'Аккаунт'],
  ['general', 'Общие'],
  ['editor', 'Редактор'],
  ['shortcuts', 'Клавиши'],
  ['decks', 'Презентации'],
  ['models', 'Модели'],
] as const;

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 900 },
]) {
  test(`all settings sections remain reachable at ${viewport.width}x${viewport.height}`, async ({
    page,
    request,
  }) => {
    await request.post('http://127.0.0.1:3121/__set-admin');
    await page.setViewportSize(viewport);
    await page.goto('/?settings=general');
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    const dialog = page.getByRole('dialog', { name: 'Настройки', exact: true });
    const mobile = viewport.width < 768;
    const navigation = dialog.getByRole('combobox', { name: 'Разделы настроек' });
    if (mobile) {
      await expect(navigation).toBeVisible();
      await expect(navigation.locator('option')).toHaveCount(sections.length);
      expect(
        await navigation.evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
      ).toBeGreaterThanOrEqual(16);
      await expect(navigation).toHaveCSS('height', '44px');
    } else {
      await expect(navigation).toBeHidden();
      await expect(dialog.getByRole('tablist')).toBeVisible();
    }
    for (const [id, title] of sections) {
      if (mobile) await navigation.selectOption(id);
      else await dialog.getByRole('tab', { name: title, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`settings=${id}`));
      await expect(dialog.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await panelFits(dialog);
      if (id === 'decks') {
        const count = dialog.getByRole('combobox', { name: 'Число слайдов', exact: true });
        await count.selectOption('15');
        await expect(count).toHaveValue('15');
        await panelFits(dialog);
      }
      if (id === 'models') {
        const headerY = (
          await dialog.getByRole('heading', { name: 'Настройки', exact: true }).boundingBox()
        )?.y;
        const speech = dialog.getByRole('button', { name: /Модель для роли «Расшифровка голоса»/ });
        await speech.scrollIntoViewIfNeeded();
        await panelFits(dialog);
        expect(
          (await dialog.getByRole('heading', { name: 'Настройки', exact: true }).boundingBox())?.y,
        ).toBe(headerY);
        await speech.click();
        const picker = page.locator('[data-slot="popover-content"]');
        await expect(picker).toBeVisible();
        await expect
          .poll(() =>
            picker.evaluate((node) => {
              const rect = node.getBoundingClientRect();
              return (
                rect.left >= 0 &&
                rect.right <= innerWidth &&
                rect.top >= 0 &&
                rect.bottom <= innerHeight
              );
            }),
          )
          .toBe(true);
        await picker.getByRole('button', { name: 'Без расшифровки голоса', exact: true }).click();
        await expect(speech).toContainText('Без расшифровки голоса');
        await panelFits(dialog);
        if (viewport.width === 390 || viewport.width === 1280) {
          await page.screenshot({
            path: `test-results/chat/settings-models-${viewport.width}.png`,
          });
        }
      }
      if (viewport.width === 390 && id !== 'models') {
        await page.screenshot({ path: `test-results/chat/settings-${id}-mobile.png` });
      }
    }
    await dialog.getByRole('button', { name: 'Закрыть настройки', exact: true }).tap();
    await expect(dialog).toBeHidden();
    await expect(page).not.toHaveURL(/settings=/);
  });
}

test('mobile connection form and nested model picker fit and preserve navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?settings=models');
  const dialog = page.getByRole('dialog', { name: 'Настройки', exact: true });
  await expect(
    dialog.getByRole('combobox', { name: 'Разделы настроек' }).locator('option'),
  ).toHaveCount(6);
  await dialog.getByRole('button', { name: 'Добавить подключение', exact: true }).click();
  await panelFits(dialog);
  const inputs = dialog.locator('input:not([type="radio"]):not([type="checkbox"]), textarea');
  for (const input of await inputs.all()) {
    expect(
      await input.evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
    ).toBeGreaterThanOrEqual(16);
  }
  const cancel = dialog.getByRole('button', { name: 'Отмена', exact: true });
  await cancel.scrollIntoViewIfNeeded();
  await panelFits(dialog);
  await cancel.click();
  await dialog.getByRole('button', { name: /Модель для роли «Основная модель»/ }).click();
  const picker = page.locator('[data-slot="popover-content"]');
  await picker.getByRole('option', { name: 'beta', exact: true }).click();
  await panelFits(dialog);
  await expect(
    dialog.getByRole('button', { name: /Модель для роли «Основная модель»/ }),
  ).toContainText('beta');
});
