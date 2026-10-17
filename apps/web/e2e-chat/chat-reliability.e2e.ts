import { expect, test } from '@playwright/test';
import type { ChatEvent, ChatMessage, DeckOutline } from '@lct/contracts';
import { signSessionToken } from '../src/lib/session-token';

const CHAT = '00000000-0000-4000-8000-0000000000cc';
const USER = '00000000-0000-4000-8000-000000000001';
const ANSWER = '00000000-0000-4000-8000-000000000002';
const PLAN = '00000000-0000-4000-8000-000000000003';
const TEMPLATE = '00000000-0000-4000-8000-000000000004';
const user: ChatMessage = {
  role: 'user',
  id: USER,
  text: 'Подготовь презентацию',
  attachments: [],
  mode: 'plan',
  createdAt: 1,
};
const assistant: ChatMessage = {
  role: 'assistant',
  id: ANSWER,
  parts: [],
  status: 'done',
  createdAt: 2,
};
const document = (messages: ChatMessage[]) => ({
  chatId: CHAT,
  title: 'Проверка чата',
  projectId: null,
  deckIds: [],
  deckId: null,
  mode: 'plan',
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  messages,
  running: false,
});
const sse = (events: ChatEvent[]) =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

test.beforeEach(async ({ context }) => {
  const value = await signSessionToken(USER, Date.now() + 3600000, 'chat-e2e-session-secret');
  await context.addCookies([
    { name: 'lct_session', value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
});

test.describe('chat reliability', () => {
  test('shows a saved material researcher step with its translated label', async ({ page }) => {
    await page.route('**/api/backend/chats/**', async (route) => {
      await route.fulfill({
        json: document([
          user,
          {
            ...assistant,
            parts: [
              {
                type: 'tool',
                callId: 'research',
                name: 'research_materials',
                input: { question: 'Какой бюджет?', fileIds: [USER] },
                status: 'done',
                output: { summary: 'Бюджет: 25 рублей.' },
              },
              { type: 'text', text: 'В brief.txt указан бюджет 25 рублей.' },
            ],
          },
        ]),
      });
    });
    await page.goto(`/chats/${CHAT}`);
    await expect(
      page.getByText('В brief.txt указан бюджет 25 рублей.', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Выполнено 1 действие', exact: true }).click();
    await expect(page.getByText('Исследовал материалы', { exact: true })).toBeVisible();
    await expect(page.getByText('research_materials', { exact: true })).toHaveCount(0);
  });

  test('recovers a response after SSE EOF without repeating the submitted turn', async ({
    page,
  }) => {
    let posted = 0;
    let reconciled = false;
    await page.route('**/api/backend/chats/**', async (route) => {
      if (route.request().method() === 'POST') {
        posted++;
        expect(route.request().postDataJSON().requestId).toMatch(/^[0-9a-f-]{36}$/);
        await route.fulfill({
          contentType: 'text/event-stream',
          body: sse([
            { type: 'message', seq: 0, message: user },
            {
              type: 'message',
              seq: 1,
              message: {
                ...assistant,
                status: 'streaming',
                parts: [{ type: 'text', text: 'Начало ответа' }],
              },
            },
          ]),
        });
      } else {
        reconciled = posted > 0;
        await route.fulfill({
          json: document(
            posted
              ? [
                  user,
                  {
                    ...assistant,
                    parts: [
                      { type: 'text', text: 'Полный сохранённый ответ после восстановления.' },
                    ],
                  },
                ]
              : [],
          ),
        });
      }
    });
    await page.goto(`/chats/${CHAT}`);
    await page.getByRole('textbox', { name: 'Сообщение агенту' }).fill('Подготовь презентацию');
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect(
      page.getByText('Полный сохранённый ответ после восстановления.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Остановить', exact: true })).toHaveCount(0);
    expect(reconciled).toBe(true);
    expect(posted).toBe(1);
  });

  test('submits the edited outline with the exact displayed plan revision', async ({ page }) => {
    const outline: DeckOutline = {
      title: 'План',
      audience: 'Команда',
      goal: 'Согласовать',
      slides: Array.from({ length: 10 }, (_, index) => ({
        title: `Слайд ${index + 1}`,
        points: ['Исходный тезис'],
        kind: 'statement',
      })),
    };
    const plan: ChatMessage = {
      ...assistant,
      parts: [
        {
          type: 'plan',
          callId: 'c1',
          planId: PLAN,
          revision: 7,
          outline,
          templateId: TEMPLATE,
          status: 'proposed',
        },
      ],
    };
    let submitted: Record<string, unknown> | undefined;
    await page.route('**/api/backend/chats/**', async (route) => {
      if (route.request().method() === 'POST') {
        submitted = route.request().postDataJSON().input;
        await route.fulfill({
          contentType: 'text/event-stream',
          body: sse([
            {
              type: 'message',
              seq: 0,
              message: { ...assistant, parts: [{ type: 'text', text: 'План принят для сборки.' }] },
            },
            { type: 'turn-end', seq: 1 },
          ]),
        });
      } else await route.fulfill({ json: document([user, plan]) });
    });
    await page.goto(`/chats/${CHAT}`);
    await page
      .getByRole('textbox', { name: 'Заголовок слайда 1', exact: true })
      .fill('Уточнённый заголовок');
    await page
      .getByRole('textbox', { name: 'Тезисы слайда 1, по одному на строку', exact: true })
      .fill('Бюджет: 9 млн\nПилот: 2027 год');
    await page.getByRole('button', { name: 'Собрать по плану', exact: true }).click();
    await expect(page.getByText('План принят для сборки.', { exact: true })).toBeVisible();
    expect(submitted).toMatchObject({
      type: 'approve-plan',
      planId: PLAN,
      revision: 7,
      templateId: TEMPLATE,
      outline: {
        slides: [
          expect.objectContaining({
            title: 'Уточнённый заголовок',
            points: ['Бюджет: 9 млн', 'Пилот: 2027 год'],
          }),
          ...outline.slides.slice(1),
        ],
      },
    });
  });
});
