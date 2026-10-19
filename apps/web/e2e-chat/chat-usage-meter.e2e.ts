import { expect, test } from '@playwright/test';
import type { ChatEvent, ChatMessage } from '@lct/contracts';
import { sessionCookie } from './session';

const CHAT = '00000000-0000-4000-8000-0000000000e1';
const USER = '00000000-0000-4000-8000-000000000001';
const ANSWER = '00000000-0000-4000-8000-0000000000e2';
const user: ChatMessage = {
  role: 'user',
  id: USER,
  text: 'Сколько токенов уйдёт на ответ?',
  attachments: [],
  mode: 'chat',
  createdAt: Date.now(),
};
const document = {
  chatId: CHAT,
  title: 'Счётчик токенов',
  projectId: null,
  deckIds: [],
  deckId: null,
  mode: 'chat',
  model: null,
  createdAt: '2026-10-19T00:00:00Z',
  updatedAt: '2026-10-19T00:00:00Z',
  messages: [],
  running: false,
};

type EventBody = {
  [T in ChatEvent['type']]: Omit<Extract<ChatEvent, { type: T }>, 'seq'>;
}[ChatEvent['type']];

const API = 'http://127.0.0.1:3121';
const usage = (outputTokens: number): EventBody => ({
  type: 'usage',
  messageId: ANSWER,
  inputTokens: 14213,
  outputTokens,
});

/**
 * The answer streams for real from the fixture API through the web proxy: Playwright's fulfill
 * would hand the browser everything at once, and a request rewritten to another origin is
 * blocked by Chromium before it leaves the browser.
 */
const head = (): EventBody[] => [
  { type: 'message', message: user },
  {
    type: 'message',
    message: {
      role: 'assistant',
      id: ANSWER,
      status: 'streaming',
      createdAt: Date.now(),
      parts: [],
    },
  },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((step) => usage(step * 37)),
  // Text arrives after a while, so both states of the meter are seen.
  { type: 'text-delta', messageId: ANSWER, index: 0, delta: 'Считаю токены. ' },
  ...[9, 10, 11, 12].map((step) => usage(step * 37)),
];
const tail = (): EventBody[] => [
  { type: 'text-delta', messageId: ANSWER, index: 0, delta: 'Готово.' },
  {
    type: 'message',
    message: {
      role: 'assistant',
      id: ANSWER,
      status: 'done',
      createdAt: Date.now(),
      parts: [{ type: 'text', text: 'Считаю токены. Готово.' }],
    },
  },
  { type: 'turn-end' },
];

test.beforeEach(async ({ context, request }) => {
  await request.post(`${API}/__reset-models`);
  await request.post(`${API}/__set-turn`, {
    data: { head: head(), tail: tail(), everyMs: 250 },
  });
  const value = await sessionCookie(USER);
  await context.addCookies([
    { name: 'lct_session', value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
});

test('the answer shows its tokens growing while it streams, then the meter goes away', async ({
  page,
  request,
}) => {
  await page.route('**/api/backend/chats/**', async (route) => {
    if (route.request().method() === 'POST') await route.fallback();
    else await route.fulfill({ json: document });
  });
  await page.goto(`/chats/${CHAT}`);
  await page.getByRole('textbox', { name: 'Сообщение агенту' }).fill(user.text);
  await page.getByRole('textbox', { name: 'Сообщение агенту' }).press('Enter');

  const meter = page.locator('[title^="Отправлено модели"]');
  await expect(meter).toBeVisible();
  await expect(meter).toContainText('↑ 14,2 тыс.');
  await expect(page.getByText('Думаю…')).toBeVisible();
  const received = async () => Number((await meter.textContent())?.match(/↓ (\d+)/)?.[1]);
  const first = await received();
  await expect.poll(received).toBeGreaterThan(first);
  await page.screenshot({ path: 'test-results/chat/usage-meter.png' });

  // The answer is writing: the thinking line is gone, the meter stays under the text.
  await expect(page.getByText('Считаю токены.')).toBeVisible();
  await expect(page.getByText('Думаю…')).toBeHidden();
  await expect(meter).toBeVisible();
  await page.screenshot({ path: 'test-results/chat/usage-meter-writing.png' });

  await request.post(`${API}/__release-turn`);
  await expect(page.getByText('Считаю токены. Готово.')).toBeVisible();
  await expect(meter).toBeHidden();
});
