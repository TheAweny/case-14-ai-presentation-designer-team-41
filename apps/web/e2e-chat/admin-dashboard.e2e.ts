import { expect, test, type Page } from '@playwright/test';
import { sessionCookie } from './session';
import type { AccountUsageView } from '@lct/contracts';

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
const administrator = accounts[1];
if (!person || !administrator) throw new Error('Admin fixture needs a user account.');

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
  await page.screenshot({ path: 'test-results/admin-overview.png', fullPage: true });
  await expect(page.getByRole('tab', { name: 'Обзор', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.getByRole('tab', { name: 'Люди', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Пользователи', exact: true })).toBeVisible();
  await expect(page.getByText(person.email)).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-people-desktop.png', fullPage: true });

  await page.getByRole('tab', { name: 'Настройки', exact: true }).click();
  await page.getByRole('radio', { name: person.email }).click();
  const generation = page.getByRole('group', { name: 'Успешные генерации', exact: true });
  await generation.getByRole('radio', { name: 'Лимит', exact: true }).click();
  await generation.getByRole('spinbutton').fill('4');
  await page.getByRole('button', { name: 'Сохранить ограничения', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Активность и ограничения' }).getByRole('status'),
  ).toHaveText('Сохранено');
  await page.screenshot({ path: 'test-results/admin-settings-desktop.png', fullPage: true });

  // The metrics section is the `metrics` view. Its Russian tab label is «Показатели».
  await page.getByRole('tab', { name: 'Показатели', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Показатели', exact: true })).toBeVisible();
  await expect(page.getByText(person.email)).toBeVisible();
  await expect(page.getByText('Данные 2 из 2 аккаунтов')).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-metrics-desktop.png', fullPage: true });
});

test('admin filters users, handles a duplicate email, and persists a profile', async ({ page }) => {
  await page.goto('/admin?view=people');
  await expect(page.getByText(person.email)).toBeVisible();
  await page.getByRole('combobox', { name: 'Роль', exact: true }).selectOption('admin');
  await expect(page.getByText(person.email)).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Роль', exact: true }).selectOption('all');
  await page.getByLabel('Поиск по имени или почте').fill(' АДА ');
  await expect(page.getByText(administrator.email)).toHaveCount(0);
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
  const form = page.getByRole('form', { name: `Профиль: ${person.email}` });
  await form.getByLabel('Почта', { exact: true }).fill(administrator.email);
  await form.getByRole('button', { name: 'Сохранить профиль' }).click();
  await expect(
    page.getByText('Аккаунт с такой почтой уже есть.', { exact: false }).first(),
  ).toBeVisible();
  await expect(form).toBeVisible();
  await form.getByLabel('Почта', { exact: true }).fill('ada.updated@example.test');
  await form.getByLabel('Имя', { exact: true }).fill('Ада — обновлённый профиль');
  await form.getByRole('button', { name: 'Сохранить профиль' }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByText('ada.updated@example.test', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByText('ada.updated@example.test', { exact: false })).toBeVisible();
});

test('unsaved policies survive attempted navigation and can be discarded or inherited', async ({
  page,
}) => {
  await page.goto(`/admin?view=limits&account=${person.id}`);
  const generation = page.getByRole('group', { name: 'Успешные генерации', exact: true });
  await generation.getByRole('radio', { name: 'Лимит', exact: true }).click();
  await generation.getByRole('spinbutton').fill('7');
  await page.getByRole('tab', { name: 'Показатели', exact: true }).click();
  await expect(page.getByText('Есть несохранённые изменения.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить редактирование' }).click();
  await expect(generation.getByRole('spinbutton')).toHaveValue('7');
  await page.getByRole('radio', { name: 'Для всех', exact: true }).click();
  await expect(page.getByText('У текущего аккаунта есть несохранённые правки.')).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить редактирование' }).click();
  await page.getByRole('button', { name: 'Сохранить ограничения', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Активность и ограничения' }).getByRole('status'),
  ).toHaveText('Сохранено');
  await page.getByRole('button', { name: 'Вернуть всё к общей политике' }).click();
  await page.getByRole('button', { name: 'Сохранить ограничения', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Активность и ограничения' }).getByRole('status'),
  ).toHaveText('Сохранено');
  await expect(generation.getByRole('radio', { name: 'Как у всех', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.reload();
  await expect(generation.getByRole('radio', { name: 'Как у всех', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

function metricView(start = '1970-01-01T00:00:00.000Z'): AccountUsageView {
  return {
    defaults: {},
    override: {},
    effective: {},
    storageBytes: 1024,
    metrics: ['generation', 'assistant-response', 'edit', 'concurrency'].map((metric) => ({
      metric: metric as 'generation' | 'assistant-response' | 'edit' | 'concurrency',
      limit: null,
      start,
      end: null,
      completed: 3,
      active: 0,
    })),
  };
}

test('model settings preserve personal scope and unsaved limits', async ({ page }) => {
  await page.goto(`/admin?view=limits&account=${person.id}`);
  const generation = page.getByRole('group', { name: 'Успешные генерации', exact: true });
  await generation.getByRole('radio', { name: 'Лимит', exact: true }).click();
  await generation.getByRole('spinbutton').fill('17');
  await page.getByRole('button', { name: 'Модели и подключения', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Настройки', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`account=${person.id}.*settings=models`));
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(generation.getByRole('spinbutton')).toHaveValue('17');
  await expect(page.getByRole('heading', { name: person.email, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Отменить правки', exact: true }).click();
});

test('personal usage shows reset date in the policy timezone only for periodic limits', async ({
  page,
  request,
}) => {
  const view = metricView();
  const generation = view.metrics.find((row) => row.metric === 'generation');
  if (!generation) throw new Error('Missing generation counter');
  generation.limit = { limit: 10, period: 'day', timezone: 'Europe/Moscow' };
  generation.start = '2026-10-19T21:00:00.000Z';
  generation.end = '2026-10-20T21:00:00.000Z';
  await request.post(`${API}/__set-admin-usage`, { data: { me: view } });
  await page.goto('/?settings=account');
  const activity = page.getByRole('region', { name: 'Активность и ограничения', exact: true });
  await expect(activity.getByText(/Сброс .*21 окт\. 2026.*00:00.*Europe\/Moscow/)).toBeVisible();
  generation.limit = { limit: 10, period: 'lifetime', timezone: 'UTC' };
  generation.end = null;
  await request.post(`${API}/__set-admin-usage`, { data: { me: view } });
  await page.reload();
  await expect(activity.getByText('За всё время', { exact: false })).toHaveCount(0);
  await expect(activity.getByText(/Сброс/)).toHaveCount(0);
});

test('metrics retain failed accounts, recover on refresh and avoid mixed-window totals', async ({
  page,
  request,
}) => {
  await request.post(`${API}/__set-admin-usage`, {
    data: { [person.id]: metricView(), [administrator.id]: null },
  });
  await page.goto('/admin?view=metrics');
  await expect(page.getByText('Данные 1 из 2 аккаунтов')).toBeVisible();
  await expect(page.getByText(administrator.email)).toBeVisible();
  await expect(page.getByText('Данные аккаунта не загрузились.', { exact: false })).toBeVisible();
  await expect(page.locator('section > dl > div > dd')).toHaveText(['—', '—', '—']);
  await request.post(`${API}/__set-admin-usage`, {
    data: { [administrator.id]: metricView('2026-10-01T00:00:00.000Z') },
  });
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByText('Данные 2 из 2 аккаунтов')).toBeVisible();
  await expect(page.locator('section > dl > div > dd')).toHaveText(['—', '—', '2 КБ']);
  await page
    .getByRole('listitem', { name: 'Аккаунт Ада Лавлейс' })
    .getByRole('button', { name: 'Лимиты и сессии' })
    .click();
  await expect(page).toHaveURL(new RegExp(`account=${person.id}`));
  await expect(page.getByRole('heading', { name: person.email, exact: true })).toBeVisible();
});

test('admin page does not scroll horizontally at 390x844', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin');
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await expect(page.getByRole('heading', { name: 'Администрирование', exact: true })).toBeVisible();
  await noHorizontalDocumentScroll(page);
  for (const [tab, file] of [
    ['Люди', 'people'],
    ['Настройки', 'settings'],
    ['Показатели', 'metrics'],
  ] as const) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    if (tab === 'Люди')
      await expect(page.getByText('Показано 2 из 2', { exact: true })).toBeVisible();
    if (tab === 'Настройки')
      await expect(page.getByText('Все изменения сохранены', { exact: true })).toBeVisible();
    if (tab === 'Показатели') await expect(page.getByText('Данные 2 из 2 аккаунтов')).toBeVisible();
    await noHorizontalDocumentScroll(page);
    await page.screenshot({ path: `test-results/admin-mobile-${file}.png`, fullPage: true });
  }
});

async function noHorizontalDocumentScroll(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
}
