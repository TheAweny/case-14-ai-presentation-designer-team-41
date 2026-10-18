import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import type { ChatEvent, ChatMessage } from '@lct/contracts';
import { signSessionToken } from '../src/lib/session-token';

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

let server: Server;
let origin = '';
let release!: () => void;

/** The answer streams for real: Playwright's fulfill would hand the browser everything at once. */
test.beforeAll(async () => {
  server = createServer((_, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    let seq = 0;
    const send = (event: EventBody) =>
      response.write(`data: ${JSON.stringify({ ...event, seq: seq++ })}\n\n`);
    send({ type: 'message', message: user });
    send({
      type: 'message',
      message: {
        role: 'assistant',
        id: ANSWER,
        status: 'streaming',
        createdAt: Date.now(),
        parts: [],
      },
    });
    let output = 0;
    const timer = setInterval(() => {
      output += 37;
      send({ type: 'usage', messageId: ANSWER, inputTokens: 14213, outputTokens: output });
      // Text arrives after a while, so both states of the meter are seen.
      if (output === 37 * 8)
        send({ type: 'text-delta', messageId: ANSWER, index: 0, delta: 'Считаю токены. ' });
    }, 250);
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    void gate.then(() => {
      clearInterval(timer);
      send({ type: 'text-delta', messageId: ANSWER, index: 0, delta: 'Готово.' });
      send({
        type: 'message',
        message: {
          role: 'assistant',
          id: ANSWER,
          status: 'done',
          createdAt: Date.now(),
          parts: [{ type: 'text', text: 'Считаю токены. Готово.' }],
        },
      });
      send({ type: 'turn-end' });
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(() => {
  server.close();
});

test.beforeEach(async ({ context }) => {
  const value = await signSessionToken(USER, Date.now() + 3600000, 'chat-e2e-session-secret');
  await context.addCookies([
    { name: 'lct_session', value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
});

test('the answer shows its tokens growing while it streams, then the meter goes away', async ({
  page,
}) => {
  await page.route('**/api/backend/chats/**', async (route) => {
    if (route.request().method() === 'POST') await route.continue({ url: `${origin}/turn` });
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

  release();
  await expect(page.getByText('Считаю токены. Готово.')).toBeVisible();
  await expect(meter).toBeHidden();
});
