import { expect, test, type Page } from '@playwright/test';
import type { ChatTurnRequest } from '@lct/contracts';
import { signSessionToken } from '../src/lib/session-token';

const CHAT = '00000000-0000-4000-8000-0000000000ee';
const USER = '00000000-0000-4000-8000-000000000001';
const ANSWER = '00000000-0000-4000-8000-000000000002';

const connection = (connectionId: string, name: string, models: string[]) => ({
  connectionId,
  name,
  preset: 'custom',
  baseUrl: 'https://models.example.test/v1',
  hasKey: true,
  keyHint: null,
  managed: false,
  editable: true,
  lastCheck: { ok: true, at: '2026-10-15T00:00:00Z', models },
});

const settings = {
  connections: [
    connection('fixture', 'Test models', ['alpha', 'beta']),
    connection('spare', 'Spare models', ['gamma']),
  ],
  roles: [
    { role: 'writer', kind: 'model', connectionId: 'fixture', modelId: 'alpha' },
    { role: 'assistant', kind: 'model', connectionId: 'fixture', modelId: 'beta' },
    { role: 'planner', kind: 'unassigned' },
    { role: 'critic', kind: 'unassigned' },
    { role: 'vision', kind: 'unassigned' },
    { role: 'image', kind: 'disabled' },
  ],
};

const user = {
  role: 'user' as const,
  id: USER,
  text: 'Исследуй тему',
  attachments: [],
  mode: 'plan' as const,
  createdAt: 1,
};

function failedAnswer(failure: {
  kind: 'quota-exhausted' | 'rate-limit';
  modelId: string;
  connectionId?: string;
  retryAt?: number;
}) {
  const error = {
    type: 'error' as const,
    message: 'provider error code token_quota_exhausted',
    failure,
  };
  return {
    role: 'assistant' as const,
    id: ANSWER,
    status: 'failed' as const,
    createdAt: 2,
    parts:
      failure.kind === 'quota-exhausted'
        ? [
            {
              type: 'tool' as const,
              callId: 'research',
              name: 'research_topic',
              input: { query: 'тема' },
              status: 'done' as const,
              output: { summary: 'Нашёл три источника по теме.' },
            },
            error,
          ]
        : [error],
  };
}

const document = (failure: Parameters<typeof failedAnswer>[0]) => ({
  chatId: CHAT,
  title: 'Квота',
  projectId: null,
  deckIds: [],
  deckId: null,
  mode: 'plan',
  model: null,
  createdAt: '2026-10-18T00:00:00Z',
  updatedAt: '2026-10-18T00:00:00Z',
  messages: [user, failedAnswer(failure)],
  running: false,
});

const stream = (text: string) =>
  [
    {
      type: 'message',
      seq: 0,
      message: {
        ...user,
        id: '00000000-0000-4000-8000-000000000003',
        text,
      },
    },
    {
      type: 'message',
      seq: 1,
      message: {
        role: 'assistant',
        id: '00000000-0000-4000-8000-000000000004',
        status: 'done',
        createdAt: 4,
        parts: [{ type: 'text', text: 'Продолжение принято.' }],
      },
    },
    { type: 'turn-end', seq: 2 },
  ]
    .map((event) => 'data: ' + JSON.stringify(event) + '\n\n')
    .join('');

test.beforeEach(async ({ context }) => {
  const value = await signSessionToken(
    'chat-e2e-user',
    Date.now() + 3600000,
    'chat-e2e-session-secret',
  );
  await context.addCookies([
    {
      name: 'lct_session',
      value,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
    { name: 'NEXT_LOCALE', value: 'ru', domain: 'localhost', path: '/' },
  ]);
});

test.afterEach(async ({ request }) => {
  await request.post('http://127.0.0.1:3121/__reset-models');
});

async function openQuota(page: Page, failure: Parameters<typeof failedAnswer>[0]) {
  const posts: ChatTurnRequest[] = [];
  const roleWrites: unknown[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /MISSING_MESSAGE/.test(message.text())) {
      pageErrors.push(message.text());
    }
  });
  await page.route('**/api/backend/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/model-settings') && route.request().method() === 'GET') {
      await route.fulfill({ json: settings });
      return;
    }
    if (url.pathname.endsWith('/model-settings/roles') && route.request().method() === 'PUT') {
      roleWrites.push(route.request().postDataJSON());
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (url.pathname.endsWith('/turns') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as ChatTurnRequest;
      posts.push(body);
      const text = body.input.type === 'message' ? body.input.text : '';
      await route.fulfill({ contentType: 'text/event-stream', body: stream(text) });
      return;
    }
    if (route.request().method() === 'GET' && url.pathname.endsWith('/chats/' + CHAT)) {
      await route.fulfill({ json: document(failure) });
      return;
    }
    await route.fulfill({ json: [] });
  });
  await page.request.post('http://127.0.0.1:3121/__set-models', { data: settings });
  await page.goto('/chats/' + CHAT);
  await expect(page.getByRole('textbox', { name: 'Сообщение агенту' })).toBeVisible();
  return { posts, roleWrites, pageErrors };
}

test('quota after research stays visible and continue posts once', async ({ page }) => {
  const { posts, roleWrites, pageErrors } = await openQuota(page, {
    kind: 'quota-exhausted',
    modelId: 'beta',
    connectionId: 'fixture',
  });
  await expect(page.getByText('Исследовал тему', { exact: true })).toBeVisible();
  const card = page.getByRole('alert').filter({ hasText: 'Лимит API-ключа исчерпан' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('того же подключения использует тот же лимит');
  await expect(page.getByRole('button', { name: /Повторить через/ })).toHaveCount(0);
  const button = card.getByRole('button', {
    name: 'Продолжить после изменения квоты',
    exact: true,
  });
  await expect(button).toBeEnabled();
  await page.screenshot({ path: 'test-results/chat/quota-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/chat/quota-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await button.click();
  await expect.poll(() => posts).toHaveLength(1);
  expect(posts[0]?.model).toBeNull();
  expect(posts[0]?.input.type).toBe('message');
  await expect(page.getByText('Продолжение принято.', { exact: true })).toBeVisible();
  await expect(page.getByText('Исследовал тему', { exact: true })).toBeVisible();
  expect(roleWrites).toEqual([]);
  expect(posts).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test('another connection uses the ordinary continue label and sends that model', async ({
  page,
}) => {
  const { posts, roleWrites } = await openQuota(page, {
    kind: 'quota-exhausted',
    modelId: 'beta',
    connectionId: 'fixture',
  });
  const card = page.getByRole('alert').filter({ hasText: 'Лимит API-ключа исчерпан' });
  await card.getByRole('button', { name: 'Сменить модель', exact: true }).click();
  await page.getByRole('option', { name: 'gamma', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Продолжить в чате', exact: true })).toBeVisible();
  await expect(
    card.getByRole('button', { name: 'Продолжить после изменения квоты', exact: true }),
  ).toHaveCount(0);
  await card.getByRole('button', { name: 'Продолжить в чате', exact: true }).click();
  await expect.poll(() => posts).toHaveLength(1);
  expect(posts[0]?.model).toEqual({ connectionId: 'spare', modelId: 'gamma' });
  expect(roleWrites).toEqual([]);
});

test('the same connection keeps the quota label and a rate limit still waits', async ({ page }) => {
  const quota = await openQuota(page, {
    kind: 'quota-exhausted',
    modelId: 'beta',
    connectionId: 'fixture',
  });
  const card = page.getByRole('alert').filter({ hasText: 'Лимит API-ключа исчерпан' });
  await card.getByRole('button', { name: 'Сменить модель', exact: true }).click();
  await page.getByRole('option', { name: 'alpha', exact: true }).click();
  await expect(
    card.getByRole('button', { name: 'Продолжить после изменения квоты', exact: true }),
  ).toBeEnabled();
  expect(quota.posts).toHaveLength(0);
  expect(quota.roleWrites).toEqual([]);
});

test('a rate limit still waits', async ({ page }) => {
  const limited = await openQuota(page, {
    kind: 'rate-limit',
    modelId: 'beta',
    connectionId: 'fixture',
    retryAt: Date.now() + 120000,
  });
  await expect(page.getByRole('button', { name: /Повторить через/ })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Продолжить после изменения квоты', exact: true }),
  ).toHaveCount(0);
  expect(limited.posts).toHaveLength(0);
});
