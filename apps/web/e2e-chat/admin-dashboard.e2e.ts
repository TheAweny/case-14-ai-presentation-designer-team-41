import { expect, test, type Page } from '@playwright/test';
import { sessionCookie } from './session';

/**
 * Admin shell contract: views overview | people | limits | metrics.
 * The fixture API on 3121 serves the accounts and the usage view those desks parse.
 */
const API = 'http://127.0.0.1:3121';

const accounts = [
  {
    id: 'fixture-user',
    email: 'ada.limits@example.test',
    name: 'Ада Лавлейс',
    role: 'user',
    disabled: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    avatar: null,
  },
  {
    id: 'fixture-admin',
    email: 'grace.admin@example.test',
    name: 'Грейс Хоппер',
    role: 'admin',
    disabled: false,
    createdAt: '2026-10-02T00:00:00.000Z',
    avatar: null,
  },
];

const person = accounts[0];
if (!person) throw new Error('Admin fixture needs a user account.');

test.beforeEach(async ({ page, request, baseURL }) => {
  if (!baseURL) throw new Error('Admin tests require the authenticated fixture.');
  await request.post(`${API}/__reset-models`);
  await request.post(`${API}/__set-admin`);
  await request.post(`${API}/__set-users`, { data: accounts });
  const value = await sessionCookie('chat-e2e-user');
  await page.context().addCookies([
    { name: 'lct_session', value, url: baseURL },
    { name: 'NEXT_LOCALE', value: 'ru', url: baseURL },
  ]);
});

test('admin lists people, saves a generation limit, and shows that account in metrics', async ({
  page,
}) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Администрирование', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Обзор', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.getByRole('tab', { name: 'Люди', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Пользователи', exact: true })).toBeVisible();
  await expect(page.getByText(person.email)).toBeVisible();

  await page.getByRole('tab', { name: 'Ограничения', exact: true }).click();
  await page.getByRole('radio', { name: person.email }).click();
  const generation = page.getByRole('group', { name: 'Успешные генерации', exact: true });
  await generation.getByRole('radio', { name: 'Лимит', exact: true }).click();
  await generation.getByRole('spinbutton').fill('4');
  await page.getByRole('button', { name: 'Сохранить ограничения', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Активность и ограничения' }).getByRole('status'),
  ).toHaveText('Сохранено');

  // The metrics section is the `metrics` view. Its Russian tab label is «Показатели».
  await page.getByRole('tab', { name: 'Показатели', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Показатели', exact: true })).toBeVisible();
  await expect(page.getByText(person.email)).toBeVisible();
});

test('admin page does not scroll horizontally at 390x844', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin');
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await expect(page.getByRole('heading', { name: 'Администрирование', exact: true })).toBeVisible();
  await noHorizontalDocumentScroll(page);
  for (const tab of ['Люди', 'Ограничения', 'Показатели']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await noHorizontalDocumentScroll(page);
  }
});

async function noHorizontalDocumentScroll(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
}
