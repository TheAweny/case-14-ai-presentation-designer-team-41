import { test, expect, type Page } from '@playwright/test';
import { sessionCookie } from './session';

const CHAT = '00000000-0000-4000-8000-0000000000e2';
const saved = (mode = 'plan') => ({
  chatId: CHAT,
  title: 'Режимы работы',
  projectId: null,
  deckId: null,
  deckIds: [],
  mode,
  model: null,
  running: false,
  messages: [],
  createdAt: '2026-10-19T00:00:00Z',
  updatedAt: '2026-10-19T00:00:00Z',
});
const field = (page: Page) => page.getByRole('textbox', { name: 'Сообщение агенту' });
const auto = (page: Page) => page.getByRole('switch', { name: 'Авто', exact: true });

test.beforeEach(async ({ page, request, baseURL }) => {
  if (!baseURL) throw new Error('Browser tests require the fixture base URL.');
  await request.post('http://127.0.0.1:3121/__reset-models');
  const value = await sessionCookie('chat-e2e-user');
  await page.context().addCookies([
    { name: 'lct_session', value, url: baseURL },
    { name: 'NEXT_LOCALE', value: 'ru', url: baseURL },
  ]);
  await page.route(`**/api/backend/chats/${CHAT}`, (route) => route.fulfill({ json: saved() }));
});

async function open(page: Page) {
  await page.goto(`/chats/${CHAT}`);
  await expect(field(page)).toBeVisible();
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
}

test('Plan starts with Auto off; the menu and shortcuts expose only Chat and Plan', async ({
  page,
}) => {
  await open(page);
  await expect(auto(page)).not.toBeChecked();
  await page.getByRole('button', { name: 'Режим: План', exact: true }).click();
  await expect(page.getByRole('menuitemradio')).toHaveCount(2);
  await expect(page.getByRole('menuitemradio', { name: 'План', exact: true })).toBeChecked();
  await page.getByRole('menuitemradio', { name: 'Чат', exact: true }).click();
  await expect(auto(page)).toHaveCount(0);
  await field(page).fill('Черновик');
  await field(page).press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Режим: План' })).toBeVisible();
  await expect(auto(page)).not.toBeChecked();
  await auto(page).focus();
  await page.keyboard.press('Space');
  await expect(auto(page)).toBeChecked();
  await field(page).focus();
  await field(page).press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Режим: Чат' })).toBeVisible();
  await field(page).press('Shift+Tab');
  await expect(auto(page)).toBeChecked();
  await expect(field(page)).toHaveValue('Черновик');
  await field(page).fill('/');
  const list = page.getByRole('listbox', { name: 'Режимы работы' });
  await expect(list.getByRole('option')).toHaveCount(2);
  await expect(list.getByRole('option', { name: /\/auto/ })).toHaveCount(0);
  await list.getByRole('option', { name: /\/chat/ }).click();
  await field(page).fill('/');
  await list.getByRole('option', { name: /\/plan/ }).click();
  await expect(auto(page)).toBeChecked();
});

for (const mode of ['auto', 'plan', 'chat'] as const) {
  test(`restores a saved auto chat and sends API mode ${mode}`, async ({ page }) => {
    await page.route(`**/api/backend/chats/${CHAT}`, (route) =>
      route.fulfill({ json: saved('auto') }),
    );
    await open(page);
    await expect(page.getByRole('button', { name: 'Режим: План' })).toBeVisible();
    await expect(auto(page)).toBeChecked();
    await page.reload();
    await expect(auto(page)).toBeChecked();
    if (mode === 'plan') await auto(page).click();
    if (mode === 'chat') {
      await page.getByRole('button', { name: 'Режим: План' }).click();
      await page.getByRole('menuitemradio', { name: 'Чат', exact: true }).click();
      await page.getByRole('button', { name: 'Режим: Чат' }).click();
      await page.getByRole('menuitemradio', { name: 'План', exact: true }).click();
      await expect(auto(page)).toBeChecked();
      await field(page).press('Shift+Tab');
    }
    let body: unknown;
    await page.route(`**/api/backend/chats/${CHAT}/turns`, (route) => {
      body = route.request().postDataJSON();
      return route.fulfill({
        contentType: 'text/event-stream',
        body: 'data: {"type":"turn-end","seq":0}\n\n',
      });
    });
    await field(page).fill('Подготовь презентацию');
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect.poll(() => body).toMatchObject({ mode });
  });
}

test('the home composer defaults to approval, restores Auto and keeps it across Chat and reload', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Режим: План' })).toBeVisible();
  await expect(auto(page)).not.toBeChecked();
  await auto(page).click();
  await expect(auto(page)).toBeChecked();
  await page.getByRole('button', { name: 'Режим: План' }).click();
  await page.getByRole('menuitemradio', { name: 'Чат', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Режим: Чат' })).toBeVisible();
  await page.getByRole('button', { name: 'Режим: Чат' }).click();
  await page.getByRole('menuitemradio', { name: 'План', exact: true }).click();
  await expect(auto(page)).toBeChecked();
  await page.screenshot({ path: 'test-results/chat/plan-auto-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(auto(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/chat/plan-auto-mobile.png', fullPage: true });
});
