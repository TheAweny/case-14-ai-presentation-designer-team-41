import { expect, test } from '@playwright/test';
import type { AssistantChatMessage } from '@lct/contracts';
import { signSessionToken } from '../src/lib/session-token';

const CHAT = '00000000-0000-4000-8000-0000000000df';
const USER = '00000000-0000-4000-8000-000000000001';

test('saved toolkit actions have readable labels and retain their cited answer after reload', async ({
  page,
  context,
}) => {
  const value = await signSessionToken(
    `${USER}:session:e2e`,
    Date.now() + 3600000,
    'chat-e2e-session-secret',
  );
  await context.addCookies([
    { name: 'lct_session', value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  const answer: AssistantChatMessage = {
    role: 'assistant',
    id: '00000000-0000-4000-8000-000000000003',
    createdAt: 2,
    status: 'done',
    parts: [
      {
        type: 'tool',
        callId: 'a',
        name: 'search_materials',
        input: {},
        status: 'done',
        output: {},
      },
      { type: 'tool', callId: 'b', name: 'search_web', input: {}, status: 'done', output: {} },
      { type: 'tool', callId: 'c', name: 'calculate', input: {}, status: 'done', output: {} },
      {
        type: 'text',
        text: 'Бюджет найден в материале «Бриф». Снижение времени — 38,9%. Внешняя справка: [документация SearXNG](https://docs.searxng.org/dev/search_api.html).',
      },
    ],
  };
  await page.route(`**/api/backend/chats/${CHAT}`, (route) =>
    route.fulfill({
      json: {
        chatId: CHAT,
        title: 'Инструменты агента',
        projectId: null,
        deckIds: [],
        deckId: null,
        mode: 'plan',
        model: null,
        createdAt: '2026-10-18T00:00:00Z',
        updatedAt: '2026-10-18T00:00:00Z',
        messages: [answer],
        running: false,
      },
    }),
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await page.reload();
    else await page.goto(`/chats/${CHAT}`);
    await page.getByRole('button', { name: 'Выполнено 3 действия' }).click();
    await expect(page.getByText('Поискал в материалах', { exact: true })).toBeVisible();
    await expect(page.getByText('Поискал в интернете', { exact: true })).toBeVisible();
    await expect(page.getByText('Выполнил расчёт', { exact: true })).toBeVisible();
    await expect(page.getByText('search_materials', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'документация SearXNG' })).toHaveAttribute(
      'href',
      'https://docs.searxng.org/dev/search_api.html',
    );
    await expect(page.getByText(/Снижение времени — 38,9%/)).toBeVisible();
  }
});
