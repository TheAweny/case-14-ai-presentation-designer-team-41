import { expect, test, type Locator } from '@playwright/test';
import { signSessionToken } from '../src/lib/session-token';

const CHAT = '00000000-0000-4000-8000-0000000000e2';
const gptModels = Array.from({ length: 28 }, (_, i) => `gpt-5-${String(i).padStart(2, '0')}`);
const catalog = [
  ...gptModels,
  'claude-sonnet-4',
  'gemini-2.5-pro',
  'qwen3-max',
  'deepseek-v3',
  'grok-4',
  'llama-4',
  'mistral-large',
  'command-r',
  'phi-4',
  'glm-5.3-flash',
  'yandexgpt-5-pro',
  'custom-unknown',
];

test.beforeEach(async ({ page, request, baseURL }) => {
  if (!baseURL) throw new Error('Browser tests need the fixture base URL.');
  await request.post('http://127.0.0.1:3121/__reset-models');
  const value = await signSessionToken(
    'chat-e2e-user',
    Date.now() + 3600000,
    'chat-e2e-session-secret',
  );
  await page.context().addCookies([
    { name: 'lct_session', value, url: baseURL },
    { name: 'NEXT_LOCALE', value: 'ru', url: baseURL },
  ]);
  await page.route(`**/api/backend/chats/${CHAT}`, (route) =>
    route.fulfill({
      json: {
        chatId: CHAT,
        title: 'Прокрутка моделей',
        projectId: null,
        deckId: null,
        deckIds: [],
        mode: 'plan',
        model: null,
        running: false,
        messages: [],
        createdAt: '2026-10-18T00:00:00Z',
        updatedAt: '2026-10-18T00:00:00Z',
      },
    }),
  );
});

async function expectInsideParent(row: Locator) {
  await expect
    .poll(() =>
      row.evaluate((el) => {
        const parent = el.parentElement;
        if (!parent) return false;
        const item = el.getBoundingClientRect();
        const box = parent.getBoundingClientRect();
        return item.top >= box.top - 1 && item.bottom <= box.bottom + 1;
      }),
    )
    .toBe(true);
}

for (const narrow of [false, true]) {
  for (const lateManufacturer of [false, true]) {
    test(`model picker scrolls ${lateManufacturer ? 'selected manufacturer' : 'default keyboard option'} into its column (${narrow ? 'mobile' : 'desktop'})`, async ({
      page,
      request,
    }) => {
      if (narrow) await page.setViewportSize({ width: 390, height: 844 });
      const modelId = lateManufacturer ? 'yandexgpt-5-pro' : gptModels[0];
      if (!modelId) throw new Error('The model catalog must have a default.');
      await request.post('http://127.0.0.1:3121/__set-models', {
        data: {
          connections: [
            {
              connectionId: 'fixture',
              name: 'Full catalog',
              preset: 'custom',
              baseUrl: 'https://models.example.test/v1',
              hasKey: true,
              keyHint: null,
              managed: false,
              lastCheck: { ok: true, at: '2026-10-18T00:00:00Z', models: catalog },
            },
          ],
          roles: [
            { role: 'writer', kind: 'model', connectionId: 'fixture', modelId },
            { role: 'assistant', kind: 'model', connectionId: 'fixture', modelId },
          ],
        },
      });
      await page.goto(`/chats/${CHAT}`);
      if (lateManufacturer) {
        // Keep readable rows under enlarged text instead of letting flex compress the catalog.
        await page.addStyleTag({
          content:
            '[aria-label="Производители моделей"] button { flex-shrink: 0; min-height: 2rem; }',
        });
      }
      await page.getByRole('button', { name: `Модель: ${modelId}. Сменить модель` }).click();
      const picker = page.locator('[data-slot="popover-content"]');
      const search = picker.getByRole('combobox', { name: 'Найти модель' });
      if (lateManufacturer) {
        const maker = picker.getByRole('button', { name: 'Yandex', exact: true });
        await expect(maker).toHaveAttribute('aria-pressed', 'true');
        await expectInsideParent(maker);
        expect(await maker.evaluate((el) => el.parentElement?.scrollTop ?? 0)).toBeGreaterThan(0);
      } else {
        const list = picker.getByRole('listbox', { name: 'Модель', exact: true });
        const fallback = list.getByRole('option', {
          name: 'Использовать по умолчанию',
          exact: true,
        });
        await search.press('End');
        await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
        await search.press('Home');
        await expect(search).toHaveAttribute('aria-activedescendant', /-default$/);
        await expectInsideParent(fallback);
        await search.press('ArrowDown');
        await list.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await search.press('ArrowUp');
        await expect(search).toHaveAttribute('aria-activedescendant', /-default$/);
        await expectInsideParent(fallback);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
}
