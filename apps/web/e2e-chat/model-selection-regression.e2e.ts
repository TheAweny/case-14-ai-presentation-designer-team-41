import { expect, test } from '@playwright/test';
import { signSessionToken } from '../src/lib/session-token';

const CHAT = '00000000-0000-4000-8000-0000000000e3';
const PERSONAL = '00000000-0000-4000-8000-0000000000e4';
const sharedIds = Array.from({ length: 9 }, (_, i) => `gpt-shared-${i}`);
const personalIds = ['gemini-personal', 'gpt-shared-0'];

test.beforeEach(async ({ page, request, baseURL }) => {
  if (!baseURL) throw new Error('Model regression tests require the browser fixture.');
  await request.post('http://127.0.0.1:3121/__reset-models');
  await request.post('http://127.0.0.1:3121/__set-models', {
    data: {
      connections: [
        {
          connectionId: 'server',
          name: 'Shared gateway',
          preset: 'custom',
          baseUrl: 'https://shared.example.test/v1',
          hasKey: true,
          keyHint: null,
          managed: true,
          lastCheck: { ok: true, at: '2026-10-18T00:00:00Z', models: sharedIds },
        },
        {
          connectionId: PERSONAL,
          name: 'Personal gateway',
          preset: 'custom',
          baseUrl: 'https://personal.example.test/v1',
          hasKey: true,
          keyHint: null,
          managed: false,
          shared: false,
          editable: true,
          lastCheck: null,
          enabledModels: personalIds,
        },
      ],
      roles: [
        { role: 'writer', kind: 'model', connectionId: 'server', modelId: sharedIds[0] },
        { role: 'assistant', kind: 'model', connectionId: 'server', modelId: sharedIds[1] },
      ],
      managesShared: true,
    },
  });
  const value = await signSessionToken(
    'chat-e2e-user:session:e2e',
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
        title: 'Личные модели',
        projectId: null,
        deckId: null,
        deckIds: [],
        mode: 'chat',
        model: null,
        running: false,
        messages: [],
        createdAt: '2026-10-18T00:00:00Z',
        updatedAt: '2026-10-18T00:00:00Z',
      },
    }),
  );
});

for (const mobile of [false, true]) {
  test(`personal model not returned by discovery is selectable and sent with its connection (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/chats/${CHAT}`);
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.getByRole('button', { name: 'Модель: gpt-shared-1. Сменить модель' }).click();
    const picker = page.locator('[data-slot="popover-content"]');
    await picker.getByRole('button', { name: 'Google', exact: true }).click();
    await expect(picker.getByRole('option', { name: /gemini-personal/ })).toBeVisible();
    await page.screenshot({
      path: `test-results/chat/personal-model-${mobile ? 'mobile' : 'desktop'}.png`,
    });
    await picker.getByRole('option', { name: /gemini-personal/ }).click();
    await expect(
      page.getByRole('button', { name: 'Модель: gemini-personal. Сменить модель' }),
    ).toBeVisible();

    let sent: unknown;
    await page.route(`**/api/backend/chats/${CHAT}/turns`, (route) => {
      sent = route.request().postDataJSON().model;
      return route.fulfill({
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ type: 'turn-end', seq: 0 })}\n\n`,
      });
    });
    await page
      .getByRole('textbox', { name: 'Сообщение агенту' })
      .fill('Используй выбранное подключение');
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect.poll(() => sent).toEqual({ connectionId: PERSONAL, modelId: 'gemini-personal' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test('role settings use the same manufacturer picker and personal catalog as chat', async ({
  page,
}) => {
  await page.goto(`/chats/${CHAT}?settings=models`);
  const dialog = page.getByRole('dialog', { name: 'Настройки', exact: true });
  await dialog.getByRole('button', { name: /Модель для роли «Основная модель»/ }).click();
  const picker = page.locator('[data-slot="popover-content"]').last();
  await expect(picker.getByRole('combobox', { name: 'Найти модель' })).toBeVisible();
  await picker.getByRole('button', { name: 'Google', exact: true }).click();
  await expect(picker.getByRole('option', { name: /gemini-personal/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/chat/personal-model-settings.png' });
  await picker.getByRole('option', { name: /gemini-personal/ }).click();
  await expect(
    dialog.getByRole('button', { name: /Модель для роли «Основная модель»/ }),
  ).toContainText('gemini-personal');
});

test('identical model ids keep the chosen personal connection', async ({ page }) => {
  await page.goto(`/chats/${CHAT}`);
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.getByRole('button', { name: 'Модель: gpt-shared-1. Сменить модель' }).click();
  const picker = page.locator('[data-slot="popover-content"]');
  await picker.getByRole('button', { name: 'Все', exact: true }).click();
  const duplicates = picker.getByRole('option', { name: 'gpt-shared-0', exact: true });
  await expect(duplicates).toHaveCount(2);
  await duplicates.last().click();
  let sent: unknown;
  await page.route(`**/api/backend/chats/${CHAT}/turns`, (route) => {
    sent = route.request().postDataJSON().model;
    return route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ type: 'turn-end', seq: 0 })}\n\n`,
    });
  });
  await page.getByRole('textbox', { name: 'Сообщение агенту' }).fill('Проверь подключение');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect.poll(() => sent).toEqual({ connectionId: PERSONAL, modelId: 'gpt-shared-0' });
});

test('role picker retains manual, disabled and clear actions on a narrow screen', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/chats/${CHAT}?settings=models`);
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  const dialog = page.getByRole('dialog', { name: 'Настройки', exact: true });
  const primary = dialog.getByRole('button', { name: /Модель для роли «Основная модель»/ });
  await primary.click();
  const popover = page.locator('[data-slot="popover-content"]');
  await popover
    .getByRole('button', { name: 'Вписать id модели… · Shared gateway', exact: true })
    .click();
  const manual = dialog.getByRole('textbox', { name: 'Id модели на подключении «Shared gateway»' });
  await expect(manual).toBeFocused();
  await manual.fill('qwen-manual');
  await manual.press('Escape');
  await expect(primary).toBeVisible();
  await primary.click();
  await popover
    .getByRole('button', { name: 'Вписать id модели… · Shared gateway', exact: true })
    .click();
  await manual.fill('qwen-manual');
  await dialog.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(primary).toContainText('qwen-manual');
  const speech = dialog.getByRole('button', { name: /Модель для роли «Расшифровка голоса»/ });
  await speech.click();
  await popover.getByRole('button', { name: 'Без расшифровки голоса', exact: true }).click();
  await expect(speech).toContainText('Без расшифровки голоса');
  await speech.click();
  await popover.getByRole('button', { name: 'Снять назначение', exact: true }).click();
  await expect(speech).toContainText('Не назначена');
  const response = await request.get('http://127.0.0.1:3121/model-settings');
  expect((await response.json()).roles).toEqual(
    expect.arrayContaining([
      { role: 'writer', kind: 'model', connectionId: 'server', modelId: 'qwen-manual' },
    ]),
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/chat/model-role-mobile.png' });
});

test('chat model menu names separately configured generation roles', async ({ page, request }) => {
  await request.put('http://127.0.0.1:3121/model-settings/roles', {
    data: { role: 'planner', kind: 'model', connectionId: PERSONAL, modelId: 'gemini-personal' },
  });
  await page.goto(`/chats/${CHAT}`);
  await page.getByRole('button', { name: 'Модель: gpt-shared-1. Сменить модель' }).click();
  const picker = page.locator('[data-slot="popover-content"]');
  await expect(picker).toContainText('Для сборки настроены отдельные модели');
  await expect(picker).toContainText('Планирование: gemini-personal · Personal gateway');
});
