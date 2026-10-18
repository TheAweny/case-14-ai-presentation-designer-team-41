import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { signSessionToken } from '../src/lib/session-token';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../packages/contracts/fixtures/${name}.json`, import.meta.url),
      'utf8',
    ),
  ).valid[0].payload;

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

async function droppedFiles(page: Page, names: string[]) {
  return page.evaluateHandle((names) => {
    const data = new DataTransfer();
    for (const name of names) {
      data.items.add(new File(['Материалы'], name, { lastModified: 1 }));
    }
    return data;
  }, names);
}

test('uploads from the plus menu and sends an attachment-only message through the chat API', async ({
  page,
}) => {
  const fileId = '00000000-0000-4000-8000-000000000010';
  let uploaded = 0;
  let input: unknown;
  await page.route('**/api/backend/files/content', (route) => {
    uploaded++;
    expect(route.request().postDataBuffer()?.toString()).toContain('Факты');
    return route.fulfill({ json: { fileId, fileName: 'notes.md' } });
  });
  await page.route(`**/api/backend/chats/${ID}/turns`, (route) => {
    const body = route.request().postDataJSON();
    input = body.input;
    return route.fulfill({
      contentType: 'text/event-stream',
      body: stream([
        {
          type: 'message',
          seq: 0,
          message: {
            role: 'user',
            id: body.requestId,
            text: body.input.text,
            attachments: body.input.attachments,
            mode: body.mode,
            createdAt: 1,
          },
        },
        { type: 'message', seq: 1, message: assistant() },
        { type: 'turn-end', seq: 2 },
      ]),
    });
  });
  await openChat(page);
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: /Добавить материалы/ }).click();
  await (
    await chooser
  ).setFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('Факты') });
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.getByText('Готовый ответ', { exact: true })).toBeVisible();
  expect(uploaded).toBe(1);
  expect(input).toMatchObject({
    type: 'message',
    text: '',
    attachments: [{ kind: 'file', fileId, name: 'notes.md' }],
  });
  await expect(page.getByRole('list', { name: 'Вложения' }).getByText('notes.md')).toBeVisible();
});

test('accepts files across the home and chat pages, preserves the draft and rejects unsupported inputs', async ({
  page,
}) => {
  for (const path of ['/', `/chats/${ID}`]) {
    await page.goto(path);
    const textarea = page.locator('textarea');
    await textarea.fill('Мой черновик');
    const data = await droppedFiles(page, ['notes.md', 'notes.md', 'brand.PPTX', 'photo.png']);
    await page.dispatchEvent('body', 'dragenter', { dataTransfer: data });
    await expect(page.locator('[data-composer-drop]')).toBeVisible();
    await page.dispatchEvent('body', 'dragleave', {
      dataTransfer: data,
      clientX: 100,
      clientY: 100,
    });
    await expect(page.locator('[data-composer-drop]')).toBeVisible();
    await page.dispatchEvent('body', 'drop', { dataTransfer: data });
    await expect(page.locator('[data-composer-drop]')).toHaveCount(0);
    const attachments = page.getByRole('list', { name: 'Вложения' });
    await expect(attachments.getByText('notes.md', { exact: true })).toHaveCount(1);
    await expect(attachments.getByText('brand.PPTX', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'photo.png' })).toBeVisible();
    await expect(textarea).toHaveValue('Мой черновик');
    await page.dispatchEvent('body', 'drop', { dataTransfer: data });
    await expect(attachments.getByText('notes.md', { exact: true })).toHaveCount(1);
    await data.dispose();
  }
});

test('handles a composer drop once and clears the page highlight on escape and window exit', async ({
  page,
}) => {
  await openChat(page);
  const data = await droppedFiles(page, ['notes.md']);
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: data });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-composer-drop]')).toHaveCount(0);
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: data });
  await page.dispatchEvent('body', 'dragleave', { dataTransfer: data, clientX: 0, clientY: 0 });
  await expect(page.locator('[data-composer-drop]')).toHaveCount(0);
  await page.locator('form[aria-busy]').dispatchEvent('drop', { dataTransfer: data });
  await expect(
    page.getByRole('list', { name: 'Вложения' }).getByText('notes.md', { exact: true }),
  ).toHaveCount(1);
  const textDragPrevented = await page.evaluate(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', 'текст');
    const event = new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(textDragPrevented).toBe(false);
  await data.dispose();
});

test('uploads a dropped template separately from materials and passes both ids to the agent', async ({
  page,
}) => {
  const templateId = '00000000-0000-4000-8000-000000000011';
  const fileId = '00000000-0000-4000-8000-000000000012';
  const endpoints: string[] = [];
  let input: { attachments: unknown[] } | undefined;
  await page.route('**/api/backend/files/template', (route) => {
    endpoints.push('template');
    return route.fulfill({
      json: {
        fileId: templateId,
        fileName: 'brand.pptx',
        profile: { designSystem: fixture('DesignSystem'), templateIr: fixture('TemplateIR') },
      },
    });
  });
  await page.route('**/api/backend/files/content', (route) => {
    endpoints.push('content');
    return route.fulfill({ json: { fileId, fileName: 'notes.md' } });
  });
  await page.route(`**/api/backend/chats/${ID}/turns`, (route) => {
    const body = route.request().postDataJSON();
    input = body.input;
    return route.fulfill({
      contentType: 'text/event-stream',
      body: stream([
        {
          type: 'message',
          seq: 0,
          message: {
            role: 'user',
            id: body.requestId,
            text: body.input.text,
            attachments: body.input.attachments,
            mode: body.mode,
            createdAt: 1,
          },
        },
        { type: 'message', seq: 1, message: assistant() },
        { type: 'turn-end', seq: 2 },
      ]),
    });
  });
  await openChat(page);
  const data = await droppedFiles(page, ['brand.pptx', 'notes.md']);
  await page.dispatchEvent('body', 'drop', { dataTransfer: data });
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.getByText('Готовый ответ', { exact: true })).toBeVisible();
  expect(endpoints).toEqual(['template', 'content']);
  expect(input?.attachments).toMatchObject([
    { kind: 'template', templateId },
    { kind: 'file', fileId },
  ]);
  await data.dispose();
});

test('keeps the next files while an answer is running and restores completed tool history', async ({
  page,
}) => {
  let status = 'streaming';
  const tools = [
    { type: 'tool', callId: 'read', name: 'read_file', input: {}, status: 'done', output: {} },
    { type: 'tool', callId: 'templates', name: 'list_templates', input: {}, status: 'running' },
  ];
  await page.route(`**/api/backend/chats/${ID}`, (route) =>
    route.fulfill({
      json: savedChat(
        [
          {
            ...assistant(status),
            parts: tools.map((tool) => ({
              ...tool,
              status: status === 'done' ? 'done' : tool.status,
            })),
          },
        ],
        status === 'streaming',
      ),
    }),
  );
  await page.route(`**/api/backend/chats/${ID}/stream`, (route) => route.abort());
  await openChat(page);
  const trace = page.locator('.thought-line');
  await expect(trace.getByRole('button', { expanded: true })).toContainText('Смотрю шаблоны');
  const data = await droppedFiles(page, ['next.md']);
  await page.dispatchEvent('body', 'drop', { dataTransfer: data });
  await expect(page.getByRole('list', { name: 'Вложения' }).getByText('next.md')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Остановить', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/chat/integrated-desktop.png' });
  status = 'done';
  await page.reload();
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  const disclosure = trace.getByRole('button', { expanded: false });
  await expect(disclosure).toContainText('Выполнено 2 действия');
  await disclosure.click();
  await expect(trace.locator('ul > li > [data-tool-call][data-call-state="done"]')).toHaveCount(2);
  await expect(trace.locator('[data-task-state=running]')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/chat/integrated-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await data.dispose();
});

test('never animates unfinished tools after cancellation or failure', async ({ page }) => {
  for (const status of ['cancelled', 'failed']) {
    await page.route(`**/api/backend/chats/${ID}`, (route) =>
      route.fulfill({
        json: savedChat([
          {
            ...assistant(status),
            parts: [
              { type: 'tool', callId: 'read', name: 'read_file', input: {}, status: 'running' },
            ],
          },
        ]),
      }),
    );
    await openChat(page);
    const trace = page.locator('.thought-line');
    await expect(trace.getByRole('button', { expanded: false })).toHaveText(
      status === 'cancelled' ? 'Работа остановлена' : 'Работа прервалась',
    );
    await trace.getByRole('button').click();
    await expect(trace.locator('[data-task-state=running]')).toHaveCount(0);
    await expect(trace.locator('.assistant-shimmer')).toHaveCount(0);
  }
});

test('opens the same source menu on the home page and inside a chat', async ({ page }) => {
  for (const path of ['/', `/chats/${ID}`]) {
    await page.goto(path);
    const plus = page.getByRole('button', { name: 'Добавить', exact: true });
    await expect(page.getByRole('button', { name: 'Прикрепить файлы', exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole('button', { name: /Выбрать шаблон|Шаблон:.*Сменить шаблон/ }),
    ).toHaveCount(0);
    await plus.click();
    const menu = page.getByRole('menu', { name: 'Добавить', exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Добавить материалы/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Загрузить шаблон/ })).toBeVisible();
    expect(await menu.evaluate((element) => getComputedStyle(element).animationName)).not.toBe(
      'none',
    );
    await menu.press('Escape');
    await expect(menu).toHaveCount(0);
  }
});

test('switches menus in one click without losing text or attachments', async ({ page }) => {
  await openChat(page);
  await field(page).fill('Черновик с материалами');
  const data = await droppedFiles(page, ['notes.md']);
  await page.dispatchEvent('body', 'drop', { dataTransfer: data });
  const model = page.getByRole('button', { name: 'Модель: beta. Сменить модель' });
  await page.getByRole('button', { name: 'Режим: План' }).click();
  await model.click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.getByRole('menu', { name: 'Добавить' })).toBeVisible();
  await model.click();
  await page.getByRole('option', { name: 'alpha', exact: true }).click();
  await expect(field(page)).toHaveValue('Черновик с материалами');
  await expect(page.getByRole('list', { name: 'Вложения' }).getByText('notes.md')).toBeVisible();
  await data.dispose();
});

test('does not attach behind a dialog or steal an existing drop target', async ({ page }) => {
  await openChat(page);
  const data = await droppedFiles(page, ['notes.md']);
  await page.evaluate(() => {
    const zone = document.createElement('div');
    zone.id = 'existing-drop-target';
    zone.addEventListener('dragover', (event) => event.preventDefault());
    zone.addEventListener('drop', (event) => event.preventDefault());
    document.body.append(zone);
  });
  await page.locator('#existing-drop-target').dispatchEvent('dragover', { dataTransfer: data });
  await expect(page.locator('[data-composer-drop]')).toHaveCount(0);
  await page.locator('#existing-drop-target').dispatchEvent('drop', { dataTransfer: data });
  await expect(page.getByRole('list', { name: 'Вложения' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').dispatchEvent('drop', { dataTransfer: data });
  await expect(page.locator('form[aria-busy] li')).toHaveCount(0);
  await data.dispose();
});

test('prevents file navigation while a question awaits a text answer', async ({ page }) => {
  const question = {
    type: 'question',
    callId: 'ask',
    questionId: '00000000-0000-4000-8000-000000000013',
    question: 'Кто будет смотреть презентацию?',
    options: [],
    multiSelect: false,
    answer: null,
  };
  await page.route(`**/api/backend/chats/${ID}`, (route) =>
    route.fulfill({ json: savedChat([{ ...assistant(), parts: [question] }]) }),
  );
  await openChat(page);
  await expect(page.getByRole('button', { name: 'Добавить', exact: true })).toBeDisabled();
  const prevented = await page.evaluate(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['факты'], 'notes.md'));
    const event = new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect(page.getByRole('list', { name: 'Вложения' })).toHaveCount(0);
  await field(page).fill('Для команды');
  await expect(page.getByRole('button', { name: 'Отправить', exact: true })).toBeEnabled();
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
  await page.getByRole('option', { name: 'Использовать по умолчанию', exact: true }).click();
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
    dialog.getByRole('heading', { name: 'Изображения, голос и визуальная проверка' }),
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
  await page.getByRole('button', { name: 'Использовать основную', exact: true }).click();
  await expect(assistantPicker).toContainText('Использовать основную');
  const primary = dialog.getByRole('button', { name: /Модель для роли «Основная модель»/ });
  await primary.click();
  await page.getByRole('option', { name: 'beta', exact: true }).click();
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
  const menu = page.locator('[data-slot="popover-content"]');
  expect(await menu.evaluate((element) => getComputedStyle(element).animationName)).not.toBe(
    'none',
  );
  await menu.press('Escape');
  await advanced.click();
  await expect(dialog.getByRole('button', { name: /Модель для роли «Ассистент»/ })).toBeHidden();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await primary.click();
  expect(
    await page
      .locator('[data-slot="popover-content"]')
      .evaluate((element) => getComputedStyle(element).animationName),
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
  await expect(page.locator('[data-task-state=running]').first()).toBeVisible();
  const stop = page.getByRole('button', { name: 'Остановить', exact: true });
  await expect(stop.locator('svg path')).toHaveAttribute(
    'd',
    'M7.00 17.00L7.00 7.00L17.00 7.00L17.00 17.00L7.00 17.00',
  );
  await expect(page.getByRole('button', { name: 'Смотрю шаблоны…', exact: true })).toBeVisible();
});

test.describe('dictation', () => {
  test('shows the microphone only after a speech model is assigned', async ({ page }) => {
    await page.goto('/');
    const prompt = page.getByRole('textbox', { name: 'О чём новая презентация?' });
    await expect(prompt).toBeVisible();
    await expect(page.getByRole('button', { name: 'Диктовать' })).toHaveCount(0);
    const assigned = await page.request.put('http://127.0.0.1:3121/model-settings/roles', {
      data: { role: 'speech', kind: 'model', connectionId: 'fixture', modelId: 'alpha' },
    });
    expect(assigned.ok()).toBeTruthy();
    await page.reload();
    await prompt.fill('Тема:');
    await page.getByRole('button', { name: 'Диктовать' }).click();
    await page.getByRole('button', { name: 'Остановить диктовку' }).click();
    // Until the text arrives, the composer says so and neither takes typing nor sends.
    await expect(page.getByRole('button', { name: 'Расшифровываю запись…' })).toBeVisible();
    await expect(prompt).toHaveAttribute('readonly', '');
    await expect(page.getByRole('button', { name: 'Сгенерировать', exact: true })).toBeDisabled();
    await expect(prompt).toHaveValue('Тема: Голос услышан');
    await expect(prompt).not.toHaveAttribute('readonly');
  });
});

/** What probing a model found, as the fixture API will report it. */
async function probed(page: Page, modelId: string, reasoning: unknown) {
  const set = await page.request.put('http://127.0.0.1:3121/__capabilities', {
    data: { modelId, reasoning },
  });
  expect(set.ok()).toBeTruthy();
}

test('offers the thinking switch only where probing found one, whatever the name', async ({
  page,
}) => {
  let thinking: unknown;
  await page.route(`**/api/backend/chats/${ID}/turns`, (route) => {
    const body = route.request().postDataJSON();
    thinking = body.thinking;
    return route.fulfill({
      contentType: 'text/event-stream',
      body: stream([
        { type: 'message', seq: 0, message: assistant() },
        { type: 'turn-end', seq: 1 },
      ]),
    });
  });
  // A name that looks like a thinking model means nothing until probing says so.
  const assigned = await page.request.put('http://127.0.0.1:3121/model-settings/roles', {
    data: { role: 'assistant', kind: 'model', connectionId: 'fixture', modelId: 'Qwen/Qwen3-8B' },
  });
  expect(assigned.ok()).toBeTruthy();
  await openChat(page);
  const toggle = page.getByRole('button', { name: 'Думать при сборке' });
  await expect(page.getByRole('button', { name: /Модель: Qwen\/Qwen3-8B/ })).toBeVisible();
  await expect(toggle).toHaveCount(0);

  await probed(page, 'Qwen/Qwen3-8B', { toggle: 'enable-thinking', levels: false });
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await field(page).fill('Короткий ответ');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.getByText('Готовый ответ', { exact: true })).toBeVisible();
  expect(thinking).toBe(false);

  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

test('lets a hybrid model think on request while retaining the chat reasoning depth', async ({
  page,
}) => {
  let sent: { thinking?: unknown; reasoningEffort?: unknown } = {};
  await page.route(`**/api/backend/chats/${ID}/turns`, (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({
      contentType: 'text/event-stream',
      body: stream([
        { type: 'message', seq: 0, message: assistant() },
        { type: 'turn-end', seq: 1 },
      ]),
    });
  });
  const assigned = await page.request.put('http://127.0.0.1:3121/model-settings/roles', {
    data: { role: 'assistant', kind: 'model', connectionId: 'fixture', modelId: 'house-model' },
  });
  expect(assigned.ok()).toBeTruthy();
  await probed(page, 'house-model', { toggle: 'reasoning-effort', levels: true });
  await openChat(page);
  const toggle = page.getByRole('button', { name: 'Думать при сборке' });
  const menu = page.getByRole('button', { name: 'Модель: house-model. Сменить модель' });
  const depth = page.getByRole('slider', { name: 'Глубина размышления' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  await menu.click();
  await depth.focus();
  await page.keyboard.press('Home');
  await expect(depth).toHaveAttribute('aria-valuetext', 'Низкая');
  // How far the track sticks out past the thumb on each side, once the thumb has eased over.
  const overhang = () =>
    depth.evaluate((slider) => {
      const track = slider.firstElementChild?.getBoundingClientRect();
      const thumb = slider.lastElementChild?.getBoundingClientRect();
      if (!track || !thumb) throw new Error('The slider lost its track or thumb.');
      return { left: thumb.left - track.left, right: track.right - thumb.right };
    });
  await expect.poll(async () => (await overhang()).left).toBeLessThanOrEqual(0);
  await page.keyboard.press('End');
  await expect(depth).toHaveAttribute('aria-valuetext', 'Высокая');
  await expect.poll(async () => (await overhang()).right).toBeLessThanOrEqual(0);
  await page.keyboard.press('Escape');

  await field(page).fill('Подумай');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.getByText('Готовый ответ', { exact: true })).toBeVisible();
  expect(sent).toMatchObject({ thinking: true, reasoningEffort: 'high' });

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await menu.click();
  await expect(depth).toBeVisible();
});

test('offers only models the provider describes as chat models in the chat menu', async ({
  page,
}) => {
  const sorted = await page.request.put('http://127.0.0.1:3121/__kinds', {
    data: { alpha: ['image'], beta: ['text', 'vision'] },
  });
  expect(sorted.ok()).toBeTruthy();
  await openChat(page);
  await page.getByRole('button', { name: 'Модель: beta. Сменить модель' }).click();
  await expect(page.getByRole('option', { name: 'beta', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'alpha', exact: true })).toHaveCount(0);
});

test('lets the person mark what a model is, and the pickers follow', async ({ page }) => {
  await page.goto('/?settings=models');
  await page.getByRole('button', { name: 'Действия с подключением «Test models»' }).click();
  await page.getByRole('menuitem', { name: 'Модели' }).click();
  // Nothing describes `alpha`: it is taken for a text model that may see pictures.
  await page.getByRole('button', { name: 'Что умеет alpha: Текст и картинки' }).click();
  await page.getByRole('menuitemradio', { name: 'Изображения' }).click();
  await expect(page.getByRole('button', { name: 'Что умеет alpha: Изображения' })).toBeVisible();

  await openChat(page);
  await page.getByRole('button', { name: 'Модель: beta. Сменить модель' }).click();
  await expect(page.getByRole('option', { name: 'beta', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'alpha', exact: true })).toHaveCount(0);
});
