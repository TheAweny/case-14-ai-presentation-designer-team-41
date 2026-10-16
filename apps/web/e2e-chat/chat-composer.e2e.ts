import { test, expect, type Page } from '@playwright/test';
import { signSessionToken } from '../src/lib/session-token';

const ID = '00000000-0000-4000-8000-0000000000cc';
const ANSWER = '00000000-0000-4000-8000-000000000002';
const savedChat = (messages: unknown[] = [], running = false) => ({
  chatId: ID,
  title: 'Чат',
  projectId: null,
  deckId: null,
  deckIds: [],
  mode: 'plan',
  messages,
  running,
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
});
const assistant = (status = 'done') => ({
  role: 'assistant',
  id: ANSWER,
  createdAt: 2,
  status,
  parts: [{ type: 'text', text: 'Готовый ответ' }],
});
const stream = (events: unknown[]) =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
const field = (page: Page) => page.getByRole('textbox', { name: 'Сообщение агенту' });

test.beforeEach(async ({ page, baseURL, request }) => {
  await request.post('http://127.0.0.1:3121/__reset-models');
  if (!baseURL) throw new Error('Chat browser tests require a base URL.');
  const value = await signSessionToken(
    'chat-e2e-user',
    Date.now() + 3600000,
    'chat-e2e-session-secret',
  );
  await page.context().addCookies([
    { name: 'lct_session', value, url: baseURL },
    { name: 'NEXT_LOCALE', value: 'ru', url: baseURL },
  ]);
  await page.route('**/api/service-status', (route) =>
    route.fulfill({ json: { services: { api: 'ok', engine: 'ok', database: 'ok' } } }),
  );
  await page.route(`**/api/backend/chats/${ID}`, (route) => route.fulfill({ json: savedChat() }));
});

async function openChat(page: Page) {
  await page.goto(`/chats/${ID}`);
  await expect(field(page)).toBeVisible();
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
}

test('opens the same source menu on the home page and inside a chat', async ({ page }) => {
  for (const path of ['/', `/chats/${ID}`]) {
    await page.goto(path);
    const plus = page.getByRole('button', { name: 'Добавить материалы', exact: true });
    await plus.click();
    const menu = page.getByRole('menu', { name: 'Добавить материалы', exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Добавить материалы/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /шаблон/i })).toHaveCount(0);
    expect(await menu.evaluate((element) => getComputedStyle(element).animationName)).not.toBe(
      'none',
    );
    await menu.press('Escape');
    await expect(menu).toHaveCount(0);
    const template = page.getByRole('button', { name: /Выбрать шаблон|Шаблон:.*Сменить шаблон/ });
    await expect(template).toHaveCount(1);
    await template.click();
    await expect(page.getByRole('menuitem', { name: /Загрузить шаблон/ })).toBeVisible();
    await page.getByRole('menu').press('Escape');
  }
});

test('chooses modes with the keyboard and limits the input to five lines', async ({ page }) => {
  await openChat(page);
  await field(page).fill('/');
  const combo = page.getByRole('combobox', { name: 'Сообщение агенту' });
  await expect(page.getByRole('listbox', { name: 'Режимы работы' })).toBeVisible();
  await combo.press('Enter');
  await expect(page.getByRole('button', { name: 'Режим: Чат' })).toBeVisible();
  await expect(field(page)).toHaveValue('');
  await field(page).fill('/');
  await combo.press('Escape');
  await expect(page.getByRole('listbox', { name: 'Режимы работы' })).toHaveCount(0);
  await field(page).fill(Array.from({ length: 12 }, (_, i) => `Строка ${i}`).join('\n'));
  expect(await field(page).evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  );
});

test('retains the next draft, keeps stop available, and does not cancel on Enter', async ({
  page,
}) => {
  let turns = 0;
  let stops = 0;
  let user: unknown;
  await page.route(`**/api/backend/chats/${ID}/turns`, async (route) => {
    turns++;
    const body = route.request().postDataJSON();
    user = {
      role: 'user',
      id: body.requestId,
      text: body.input.text,
      attachments: [],
      mode: body.mode,
      createdAt: 1,
    };
    await route.fulfill({
      contentType: 'text/event-stream',
      body: stream([{ type: 'message', seq: 0, message: user }]),
    });
  });
  await page.route(`**/api/backend/chats/${ID}`, (route) =>
    route.fulfill({
      json: savedChat(
        user ? [user, assistant(stops ? 'cancelled' : 'streaming')] : [],
        Boolean(user) && !stops,
      ),
    }),
  );
  await page.route(`**/api/backend/chats/${ID}/stream`, (route) => route.abort());
  await page.route(`**/api/backend/chats/${ID}/cancel`, (route) => {
    stops++;
    return route.fulfill({ status: 204 });
  });
  await openChat(page);
  await field(page).fill('Первое сообщение');
  await field(page).press('Enter');
  await expect(page.getByRole('button', { name: 'Остановить', exact: true })).toBeVisible();
  await field(page).fill('Следующий черновик');
  await field(page).press('Enter');
  expect(stops).toBe(0);
  await page.getByRole('button', { name: 'Остановить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Отправить', exact: true })).toBeVisible();
  await expect(field(page)).toHaveValue('Следующий черновик');
  expect(turns).toBe(1);
});

test('retries an interrupted send with the same request id', async ({ page }) => {
  const ids: string[] = [];
  await page.route(`**/api/backend/chats/${ID}/turns`, async (route) => {
    const body = route.request().postDataJSON();
    ids.push(body.requestId);
    if (ids.length === 1) {
      await route.fulfill({ status: 503, body: 'Unavailable' });
      return;
    }
    const user = {
      role: 'user',
      id: body.requestId,
      text: body.input.text,
      attachments: [],
      mode: body.mode,
      createdAt: 1,
    };
    await route.fulfill({
      contentType: 'text/event-stream',
      body: stream([
        { type: 'message', seq: 0, message: user },
        { type: 'message', seq: 1, message: assistant() },
        { type: 'turn-end', seq: 2 },
      ]),
    });
  });
  await openChat(page);
  await field(page).fill('Повторяемый запрос');
  await field(page).press('Enter');
  await expect(page.getByText('Готовый ответ', { exact: true })).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  await expect(page.getByRole('button', { name: 'Копировать' }).last()).toBeVisible();
});

test('restores files after an upload error on a narrow screen with reduced motion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/backend/files/content', (route) =>
    route.fulfill({ status: 503, body: 'Upload failed' }),
  );
  await openChat(page);
  await field(page).fill('Материалы для презентации');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('Факты') });
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Вернуть в поле' })).toBeVisible();
  await page.getByRole('button', { name: 'Вернуть в поле' }).click();
  await expect(field(page)).toHaveValue('Материалы для презентации');
  await expect(
    page.getByRole('list', { name: 'Вложения' }).getByText('notes.md', { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/chat/composer-mobile.png' });
});

test('shows the assistant default, keeps model selection after reload, and resets to default', async ({
  page,
}) => {
  let model: { connectionId: string; modelId: string } | null = null;
  const messages = [
    {
      role: 'user',
      id: '00000000-0000-4000-8000-000000000003',
      text: 'Привет',
      attachments: [],
      mode: 'chat',
      createdAt: 1,
    },
    assistant(),
  ];
  await page.route(`**/api/backend/chats/${ID}`, async (route) => {
    if (route.request().method() === 'PATCH') model = route.request().postDataJSON().model;
    await route.fulfill({ json: { ...savedChat(messages), model } });
  });
  await openChat(page);
  await expect(page.getByRole('button', { name: 'Модель: beta. Сменить модель' })).toContainText(
    'По умолчанию',
  );
  await page.getByRole('button', { name: 'Модель: beta. Сменить модель' }).click();
  await page.getByRole('option', { name: 'alpha', exact: true }).click();
  await expect.poll(() => model?.modelId).toBe('alpha');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Модель: alpha. Сменить модель' })).toBeVisible();
  await page.getByRole('button', { name: 'Модель: alpha. Сменить модель' }).click();
  await page.getByRole('button', { name: 'Использовать по умолчанию · beta', exact: true }).click();
  await expect.poll(() => model).toBeNull();
  await expect(page.getByRole('button', { name: 'Модель: beta. Сменить модель' })).toContainText(
    'По умолчанию',
  );
});

test('changes a failed answer model and retries only after the explicit action', async ({
  page,
}) => {
  const user = {
    role: 'user',
    id: '00000000-0000-4000-8000-000000000003',
    text: 'Привет',
    attachments: [],
    mode: 'chat',
    createdAt: 1,
  };
  const failed = {
    ...assistant('failed'),
    parts: [
      {
        type: 'error',
        message: 'Model API HTTP 503',
        failure: { kind: 'unavailable', modelId: 'beta', connectionId: 'fixture' },
      },
    ],
  };
  let turns = 0;
  let selected: unknown;
  await page.route(`**/api/backend/chats/${ID}`, (route) =>
    route.fulfill({ json: savedChat([user, failed]) }),
  );
  await page.route(`**/api/backend/chats/${ID}/turns`, (route) => {
    turns++;
    const body = route.request().postDataJSON();
    selected = body.model;
    return route.fulfill({
      contentType: 'text/event-stream',
      body: stream([
        { type: 'message', seq: 0, message: { ...user, id: body.requestId } },
        { type: 'message', seq: 1, message: assistant() },
        { type: 'turn-end', seq: 2 },
      ]),
    });
  });
  await openChat(page);
  const card = page.getByRole('alert').filter({ hasText: 'Модель сейчас недоступна' });
  await card.getByRole('button', { name: 'Сменить модель', exact: true }).click();
  await page.getByRole('option', { name: 'alpha', exact: true }).click();
  expect(turns).toBe(0);
  await card.getByRole('button', { name: 'Повторить с alpha', exact: true }).click();
  await expect.poll(() => turns).toBe(1);
  expect(selected).toEqual({ connectionId: 'fixture', modelId: 'alpha' });
  await expect(page.getByText('Готовый ответ', { exact: true })).toBeVisible();
});

test('keeps role customization collapsed and separates the primary and visual models', async ({
  page,
}) => {
  await page.goto('/?settings=models');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Основная модель', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Модель для роли «Ассистент»/ })).toBeHidden();
  await dialog.getByText('Настроить модели для отдельных задач', { exact: false }).click();
  await expect(dialog.getByRole('button', { name: /Модель для роли «Ассистент»/ })).toBeVisible();
  await expect(
    dialog.getByRole('heading', { name: 'Изображения и визуальная проверка' }),
  ).toBeVisible();
});

test('respects cooldown and never repeats a turn with state-changing tools', async ({ page }) => {
  const user = {
    role: 'user',
    id: '00000000-0000-4000-8000-000000000003',
    text: 'Привет',
    attachments: [],
    mode: 'chat',
    createdAt: 1,
  };
  const error = {
    type: 'error',
    message: 'HTTP 429',
    failure: { kind: 'rate-limit', modelId: 'beta', retryAt: Date.now() + 120000 },
  };
  let mutated = false;
  await page.route(`**/api/backend/chats/${ID}`, (route) =>
    route.fulfill({
      json: savedChat([
        user,
        {
          ...assistant('failed'),
          parts: [
            ...(mutated
              ? [
                  {
                    type: 'tool',
                    callId: 'tool',
                    name: 'edit_slide',
                    input: {},
                    status: 'done',
                    output: {},
                  },
                ]
              : []),
            error,
          ],
        },
      ]),
    }),
  );
  await openChat(page);
  await expect(page.getByRole('button', { name: /Повторить через/ })).toBeDisabled();
  mutated = true;
  await page.reload();
  await expect(page.getByRole('button', { name: /Повторить через/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Продолжить в чате' })).toBeVisible();
});

test('saves the primary choice and lets a task explicitly follow it', async ({ page }) => {
  await page.goto('/?settings=models');
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Настроить модели для отдельных задач', { exact: false }).click();
  const assistantPicker = dialog.getByRole('button', { name: /Модель для роли «Ассистент»/ });
  await assistantPicker.click();
  await page.getByRole('menuitemradio', { name: 'Использовать основную', exact: true }).click();
  await expect(assistantPicker).toContainText('Использовать основную');
  const primary = dialog.getByRole('button', { name: /Модель для роли «Основная модель»/ });
  await primary.click();
  await page.getByRole('menuitemradio', { name: 'beta', exact: true }).click();
  await expect(primary).toContainText('beta');
  await page.reload();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: /Модель для роли «Основная модель»/ }),
  ).toContainText('beta');
  await page.goto(`/chats/${ID}`);
  await expect(page.getByRole('button', { name: 'Модель: beta. Сменить модель' })).toContainText(
    'По умолчанию',
  );
});

test('opens the editable connection directly from a model authorization error', async ({
  page,
}) => {
  const user = {
    role: 'user',
    id: '00000000-0000-4000-8000-000000000003',
    text: 'Привет',
    attachments: [],
    mode: 'chat',
    createdAt: 1,
  };
  const failed = {
    ...assistant('failed'),
    parts: [
      {
        type: 'error',
        message: 'HTTP 401',
        failure: { kind: 'unauthorized', modelId: 'beta', connectionId: 'fixture' },
      },
    ],
  };
  await page.route(`**/api/backend/chats/${ID}`, (route) =>
    route.fulfill({ json: savedChat([user, failed]) }),
  );
  await openChat(page);
  await page.getByRole('button', { name: 'Открыть подключение', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('textbox', { name: 'Название', exact: true }),
  ).toHaveValue('Test models');
});

test('animates model menus and uses a styled accessible task disclosure', async ({ page }) => {
  await page.goto('/?settings=models');
  const dialog = page.getByRole('dialog');
  const advanced = dialog.getByRole('button', { name: /Настроить модели для отдельных задач/ });
  await expect(advanced).toHaveAttribute('aria-expanded', 'false');
  await advanced.click();
  await expect(advanced).toHaveAttribute('aria-expanded', 'true');
  const primary = dialog.getByRole('button', { name: /Модель для роли «Основная модель»/ });
  await primary.click();
  const menu = page.getByRole('menu');
  expect(await menu.evaluate((element) => getComputedStyle(element).animationName)).not.toBe(
    'none',
  );
  await menu.press('Escape');
  await advanced.click();
  await expect(dialog.getByRole('button', { name: /Модель для роли «Ассистент»/ })).toBeHidden();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await primary.click();
  expect(
    await page.getByRole('menu').evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none');
});

test('restores finished build stages after reload without launching generation', async ({
  page,
}) => {
  const runId = 'saved-build';
  const base = { schemaVersion: 1, runId, at: '2026-10-15T00:00:00.000Z' };
  const events = [
    { ...base, seq: 0, type: 'stage-started', stage: 'planning' },
    { ...base, seq: 1, type: 'stage-finished', stage: 'planning', durationMs: 1000 },
    { ...base, seq: 2, type: 'stage-started', stage: 'laying-out' },
    {
      ...base,
      seq: 3,
      type: 'failed',
      stage: 'laying-out',
      code: 'model-unavailable',
      message: 'Провайдер недоступен',
      retryable: true,
    },
  ];
  const build = {
    type: 'build',
    buildId: '00000000-0000-4000-8000-000000000004',
    callId: 'build-call',
    runId,
    variantRunIds: [runId],
    templateId: '00000000-0000-4000-8000-000000000005',
    templateName: 'Дизайн',
    startedAt: 1,
    finishedAt: 2000,
    status: 'failed',
    error: 'Провайдер недоступен',
  };
  await page.route(`**/api/backend/chats/${ID}`, (route) =>
    route.fulfill({ json: savedChat([{ ...assistant(), parts: [build] }]) }),
  );
  await page.route(`**/api/backend/runs/${runId}/events?after=-1`, (route) =>
    route.fulfill({ json: events }),
  );
  let generated = 0;
  await page.route('**/api/backend/generation/**', (route) => {
    generated++;
    return route.abort();
  });
  for (let reload = 0; reload < 2; reload++) {
    if (reload) await page.reload();
    else await openChat(page);
    const disclosure = page
      .locator('section')
      .filter({ has: page.locator('[data-task-state=failed]') })
      .getByRole('button', { expanded: false });
    await expect(disclosure).toBeVisible();
    await disclosure.click();
    await expect(page.locator('[data-task-state=done]')).toBeVisible();
    await expect(page.locator('[data-task-state=failed]').last()).toBeVisible();
    await expect(page.getByText('Провайдер недоступен', { exact: true })).toBeVisible();
  }
  expect(generated).toBe(0);
});

test('shows animated tool execution and a stable send-to-stop glyph', async ({ page }) => {
  const tool = {
    type: 'tool',
    callId: 'read',
    name: 'list_templates',
    input: {},
    status: 'running',
  };
  await page.route(`**/api/backend/chats/${ID}`, (route) =>
    route.fulfill({ json: savedChat([{ ...assistant('streaming'), parts: [tool] }], true) }),
  );
  await page.route(`**/api/backend/chats/${ID}/stream`, (route) => route.abort());
  await openChat(page);
  await expect(page.locator('[data-task-state=running]')).toBeVisible();
  const stop = page.getByRole('button', { name: 'Остановить', exact: true });
  await expect(stop.locator('svg path')).toHaveAttribute(
    'd',
    'M12 6L18 6L18 12L18 18L6 18L6 12L6 6Z',
  );
  await expect(page.getByText('Смотрю шаблоны', { exact: false })).toBeVisible();
});
