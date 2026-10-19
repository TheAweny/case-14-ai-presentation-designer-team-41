import { expect, test } from '@playwright/test';
import type { AssistantChatMessage, ChatEvent, ChatMessage, ChatTurnRequest } from '@lct/contracts';
import { sessionCookie } from './session';

const CHAT = '00000000-0000-4000-8000-0000000000dd';
const USER = '00000000-0000-4000-8000-000000000001';
const ANSWER = '00000000-0000-4000-8000-000000000002';
const user: ChatMessage = {
  role: 'user',
  id: USER,
  text: 'Проверь материалы и собери колоду',
  attachments: [],
  mode: 'plan',
  createdAt: 1,
};
const answer = (running: boolean): AssistantChatMessage => ({
  role: 'assistant',
  id: ANSWER,
  status: running ? 'streaming' : 'failed',
  createdAt: 2,
  parts: [
    {
      type: 'tool',
      callId: 'read',
      name: 'read_file',
      input: {},
      status: running ? 'running' : 'failed',
    },
    {
      type: 'tool',
      callId: 'build',
      name: 'build_deck',
      input: {},
      status: 'failed',
      output: { error: 'Не удалось собрать колоду' },
    },
    ...(!running
      ? [{ type: 'error' as const, message: 'Тестовая ошибка после выполненного действия' }]
      : []),
  ],
});
const document = (running: boolean) => ({
  chatId: CHAT,
  title: 'Переходы и восстановление',
  projectId: null,
  deckIds: [],
  deckId: null,
  mode: 'plan',
  model: null,
  createdAt: '2026-10-18T00:00:00Z',
  updatedAt: '2026-10-18T00:00:00Z',
  messages: [user, answer(running)],
  running,
});
const sse = (events: ChatEvent[]) =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

test.beforeEach(async ({ context }) => {
  const value = await sessionCookie(USER);
  await context.addCookies([
    { name: 'lct_session', value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
});

test('continue after a partial failure sends one new message and preserves the draft', async ({
  page,
}) => {
  const posts: ChatTurnRequest[] = [];
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route('**/api/backend/chats/**', async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON() as ChatTurnRequest);
      await gate;
      await route.fulfill({
        contentType: 'text/event-stream',
        body: sse([
          {
            type: 'message',
            seq: 0,
            message: {
              ...user,
              id: '00000000-0000-4000-8000-000000000003',
              text: posts[0]?.input.type === 'message' ? posts[0].input.text : '',
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
              parts: [{ type: 'text', text: 'Продолжение принято, прежние действия сохранены.' }],
            },
          },
          { type: 'turn-end', seq: 2 },
        ]),
      });
    } else await route.fulfill({ json: document(false) });
  });
  try {
    await page.goto(`/chats/${CHAT}`);
    const field = page.getByRole('textbox', { name: 'Сообщение агенту' });
    await field.fill('Мой несохранённый вопрос');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Добавить материалы/ }).click();
    await (
      await chooser
    ).setFiles({
      name: 'unsent-notes.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('Материал из черновика'),
    });
    await expect(
      page.getByRole('list', { name: 'Вложения' }).getByText('unsent-notes.md'),
    ).toBeVisible();
    const button = page.getByRole('button', { name: 'Продолжить в чате', exact: true });
    await expect(button).toBeVisible();
    await button.click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]?.input.type).toBe('message');
    if (posts[0]?.input.type === 'message') {
      expect(posts[0].input.text).toContain('Продолжи');
      expect(posts[0].input.text).not.toContain('Мой несохранённый вопрос');
      expect(posts[0].input.attachments).toEqual([]);
    }
    expect(posts[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(field).toHaveValue('Мой несохранённый вопрос');
    await expect(
      page.getByRole('list', { name: 'Вложения' }).getByText('unsent-notes.md'),
    ).toBeVisible();
    finish();
    await expect(
      page.getByText('Продолжение принято, прежние действия сохранены.', { exact: true }),
    ).toBeVisible();
    await expect(field).toHaveValue('Мой несохранённый вопрос');
    expect(posts).toHaveLength(1);
    await page.screenshot({ path: 'test-results/chat/continue-after-failure.png', fullPage: true });
  } finally {
    finish();
  }
});

for (const reduced of [false, true]) {
  test(`glyph settles from running to failed without remounting (${reduced ? 'reduced' : 'normal'} motion)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    let settle!: () => void;
    const gate = new Promise<void>((resolve) => {
      settle = resolve;
    });
    let settled = false;
    await page.route('**/api/backend/chats/**', async (route) => {
      if (new URL(route.request().url()).pathname.endsWith('/stream')) {
        await gate;
        settled = true;
        await route.fulfill({
          contentType: 'text/event-stream',
          body: sse([
            { type: 'message', seq: 0, message: answer(false) },
            { type: 'turn-end', seq: 1 },
          ]),
        });
      } else await route.fulfill({ json: document(!settled) });
    });
    try {
      await page.goto(`/chats/${CHAT}`);
      const glyph = page.locator('.thought-line .task-lattice').first();
      await expect(glyph).toHaveAttribute('data-task-state', 'running');
      const node = await glyph.elementHandle();
      const wave = !reduced
        ? await glyph.evaluateHandle(
            (el) =>
              el
                .querySelector('[data-glyph-layer="running"] .task-lattice-cell:not([data-hole])')
                ?.getAnimations()[0],
          )
        : null;
      const before = await glyph.boundingBox();
      const duringRunning = await glyph.evaluate((el) => ({
        infinite: el
          .getAnimations({ subtree: true })
          .filter((a) => a.effect?.getTiming().iterations === Infinity).length,
        transition: getComputedStyle(el.querySelector('[data-glyph-layer="running"]') ?? el)
          .transitionDuration,
      }));
      if (reduced) expect(duringRunning.infinite).toBe(0);
      else {
        expect(duringRunning.infinite).toBeGreaterThan(0);
        expect(
          duringRunning.transition
            .split(',')
            .some((value) => parseFloat(value) > 0 && parseFloat(value) <= 0.3),
        ).toBe(true);
      }
      settle();
      await expect(glyph).toHaveAttribute('data-task-state', 'failed');
      expect(await glyph.evaluate((el, original) => el === original, node)).toBe(true);
      if (wave) {
        expect(
          await glyph.evaluate(
            (el, animation) => el.getAnimations({ subtree: true }).includes(animation as Animation),
            wave,
          ),
        ).toBe(true);
        expect(await wave.evaluate((animation) => (animation as Animation).playState)).toBe(
          'paused',
        );
      }
      const after = await glyph.boundingBox();
      expect(after?.width).toBe(before?.width);
      expect(after?.height).toBe(before?.height);
      await expect(
        page.getByRole('button', { name: 'Продолжить в чате', exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: `test-results/chat/glyph-failed-${reduced ? 'reduced' : 'normal'}.png`,
        fullPage: true,
      });
    } finally {
      settle();
    }
  });
}
