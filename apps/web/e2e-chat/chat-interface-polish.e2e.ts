import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { signSessionToken } from '../src/lib/session-token';

const CHAT = '00000000-0000-4000-8000-0000000000e1';
const saved = (parts: unknown[] = []) => ({
  chatId: CHAT,
  title: 'Проверка интерфейса',
  projectId: null,
  deckId: null,
  deckIds: [],
  mode: 'plan',
  model: null,
  running: false,
  createdAt: '2026-10-18T00:00:00Z',
  updatedAt: '2026-10-18T00:00:00Z',
  messages: parts.length
    ? [
        {
          role: 'assistant',
          id: '00000000-0000-4000-8000-000000000002',
          createdAt: 2,
          status: 'failed',
          parts,
        },
      ]
    : [],
});
const tool = (callId: string, status: string) => ({
  type: 'tool',
  callId,
  name: 'search_web',
  input: { query: callId },
  status,
  startedAt: 1,
  finishedAt: 2,
  ...(status === 'failed' ? { output: { error: 'web_http_403' } } : { output: {} }),
});

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
  await page.route(`**/api/backend/chats/${CHAT}`, (route) => route.fulfill({ json: saved() }));
});

async function open(page: Page) {
  await page.goto(`/chats/${CHAT}`);
  await expect(page.getByRole('textbox', { name: 'Сообщение агенту' })).toBeVisible();
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
}

test('mixed results use a partial glyph and the error disclosure is keyboard accessible', async ({
  page,
}) => {
  await page.route(`**/api/backend/chats/${CHAT}`, (route) =>
    route.fulfill({
      json: saved([
        tool('successful-search', 'done'),
        tool('blocked-page', 'failed'),
        { type: 'error', message: 'Достигнут предел шагов. ' + 'ДлинныйТекст'.repeat(60) },
      ]),
    }),
  );
  await open(page);
  await expect(page.locator('.thought-line [data-task-state="partial"]')).toHaveCount(1);
  const partialGlyph = page.locator('.thought-line [data-task-state="partial"]');
  await expect(partialGlyph.locator('svg')).toHaveCount(0);
  await expect(partialGlyph.locator('[data-glyph-layer="settled"] [data-lit]')).toHaveCount(4);
  await expect(page.locator('.thought-line [data-task-state="failed"]')).toHaveCount(0);
  const card = page.getByRole('alert');
  await expect(card.locator('details')).toHaveCount(0);
  const disclosure = card.getByRole('button', { name: 'Подробности', exact: true });
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(card.getByText(/Достигнут предел шагов/)).toBeVisible();
  await page.screenshot({ path: 'test-results/chat/polish-error-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await disclosure.press('Space');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  const detailsId = await disclosure.getAttribute('aria-controls');
  if (!detailsId) throw new Error('Disclosure must control its details panel.');
  const panel = page.locator(`[id="${detailsId}"]`);
  await expect(panel).toHaveAttribute('aria-hidden', 'true');
  await expect(panel).toHaveAttribute('inert', '');
  await expect.poll(async () => (await panel.boundingBox())?.height ?? -1).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/chat/polish-error-mobile.png', fullPage: true });
});

test('a complete tool failure keeps the failure glyph', async ({ page }) => {
  await page.route(`**/api/backend/chats/${CHAT}`, (route) =>
    route.fulfill({ json: saved([tool('blocked-page', 'failed')]) }),
  );
  await open(page);
  await expect(page.locator('.thought-line [data-task-state="failed"]')).toHaveCount(1);
  await expect(page.locator('.thought-line [data-task-state="partial"]')).toHaveCount(0);
});

test('slash selection moves its highlight without delaying keyboard actions', async ({ page }) => {
  await open(page);
  const field = page.getByRole('textbox', { name: 'Сообщение агенту' });
  await field.fill('/');
  const commandField = page.getByRole('combobox', { name: 'Сообщение агенту' });
  const list = page.getByRole('listbox', { name: 'Режимы работы' });
  const highlight = list.locator('.menu-glow');
  await expect(highlight).toHaveCount(1);
  await commandField.press('ArrowDown');
  await expect(list.getByRole('option', { selected: true })).toContainText('/plan');
  expect(await highlight.evaluate((el) => getComputedStyle(el).transitionProperty)).toContain(
    'transform',
  );
  expect(
    await highlight.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration)),
  ).toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const a = await highlight.boundingBox();
      const b = await list.getByRole('option', { selected: true }).boundingBox();
      return a && b ? Math.abs(a.y - b.y) : 100;
    })
    .toBeLessThan(2);
  await list.getByRole('option').last().hover();
  await expect(list.getByRole('option', { selected: true })).toContainText('/auto');
  await commandField.press('Enter');
  await expect(page.getByRole('button', { name: 'Режим: Авто' })).toBeVisible();
  await expect(list).toHaveCount(0);
  await page.mouse.move(0, 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await field.fill('/');
  await expect(list.getByRole('option', { selected: true })).toContainText('/chat');
  await commandField.press('ArrowDown');
  await expect(list.getByRole('option', { selected: true })).toContainText('/plan');
  expect(
    await highlight.evaluate((el) =>
      getComputedStyle(el)
        .transitionDuration.split(',')
        .every((value) => parseFloat(value) === 0),
    ),
  ).toBe(true);
  await commandField.press('Escape');
  await expect(list).toHaveCount(0);
});

test('nested template scrolling keeps the highlight inside the library viewport', async ({
  page,
  request,
}) => {
  const fixture = (name: string) =>
    JSON.parse(
      readFileSync(
        new URL(`../../../packages/contracts/fixtures/${name}.json`, import.meta.url),
        'utf8',
      ),
    ).valid[0].payload;
  await request.post('http://127.0.0.1:3121/__set-templates', {
    data: Array.from({ length: 18 }, (_, i) => ({
      fileId: `00000000-0000-4000-8000-${String(i + 200).padStart(12, '0')}`,
      fileName: `Template ${i}.pptx`,
      createdAt: new Date(2026, 9, 18, 0, i).toISOString(),
      profile: { designSystem: fixture('DesignSystem'), templateIr: fixture('TemplateIR') },
    })),
  });
  await open(page);
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Добавить', exact: true });
  const rows = menu.getByRole('menuitemradio');
  await expect(rows).toHaveCount(18);
  const row = rows.nth(2);
  await row.focus();
  await expect(row).toHaveAttribute('data-highlighted', '');
  // A viewport can scroll while its highlighted child remains unchanged (wheel/trackpad).
  await row.evaluate((el) => {
    const parent = el.parentElement;
    if (!parent) throw new Error('The template row needs its scrolling container.');
    parent.scrollTop += 32;
    parent.dispatchEvent(new Event('scroll'));
  });
  await expect
    .poll(async () => {
      const a = await row.boundingBox();
      const glow = await menu.locator('.menu-glow').evaluateAll((nodes) =>
        nodes
          .filter((el) => getComputedStyle(el).opacity !== '0')
          .map((el) => ({
            y: el.getBoundingClientRect().y,
            height: el.getBoundingClientRect().height,
          })),
      );
      return a && glow.length ? Math.min(...glow.map((g) => Math.abs(g.y - a.y))) : 100;
    })
    .toBeLessThan(2);
  await row.evaluate((el) => {
    const parent = el.parentElement;
    if (!parent) throw new Error('The template row needs its scrolling container.');
    parent.scrollTop = parent.scrollHeight;
  });
  // The offscreen selected row must not paint a floating highlight over another section.
  await expect
    .poll(async () =>
      menu.locator('.menu-glow').evaluateAll((nodes) => {
        const visible = nodes.filter(
          (el) =>
            getComputedStyle(el).opacity !== '0' && getComputedStyle(el).visibility !== 'hidden',
        );
        return visible.every((el) => {
          const rect = el.getBoundingClientRect();
          let parent = el.parentElement;
          while (parent) {
            const style = getComputedStyle(parent);
            const bounds = parent.getBoundingClientRect();
            if (
              /(auto|scroll|hidden|clip)/.test(style.overflowY) &&
              (rect.bottom <= bounds.top || rect.top >= bounds.bottom)
            )
              return true;
            parent = parent.parentElement;
          }
          return getComputedStyle(el).clipPath !== 'none';
        });
      }),
    )
    .toBe(true);
  await menu.getByRole('menuitem', { name: /Загрузить шаблон/ }).hover();
  await page.screenshot({ path: 'test-results/chat/polish-source-menu.png', fullPage: true });
  await page.keyboard.press('Escape');
});

for (const narrow of [false, true]) {
  test(`manufacturer browsing preserves global search, duplicates and the default (${narrow ? 'mobile' : 'desktop'})`, async ({
    page,
    request,
  }) => {
    if (narrow) await page.setViewportSize({ width: 390, height: 844 });
    const connection = (connectionId: string, models: string[]) => ({
      connectionId,
      name: connectionId === 'fixture' ? 'Primary server' : 'Spare server',
      preset: 'custom',
      baseUrl: 'https://models.example.test/v1',
      hasKey: true,
      keyHint: null,
      managed: false,
      lastCheck: { ok: true, at: '2026-10-15T00:00:00Z', models },
    });
    await request.post('http://127.0.0.1:3121/__set-models', {
      data: {
        connections: [
          connection('fixture', [
            'gpt-5',
            'gpt-4.1',
            'claude-sonnet-4',
            'gemini-2.5-pro',
            'qwen3-max',
            'grok-4',
            'glm-5.3-flash',
            'yandexgpt-5-pro',
            'aliceai-llm',
            'custom-unknown',
          ]),
          connection('spare', ['gpt-5']),
        ],
        roles: [
          { role: 'writer', kind: 'model', connectionId: 'fixture', modelId: 'gpt-5' },
          { role: 'assistant', kind: 'model', connectionId: 'fixture', modelId: 'gpt-5' },
        ],
      },
    });
    let picked: unknown = null;
    await page.route(`**/api/backend/chats/${CHAT}`, async (route) => {
      if (route.request().method() === 'PATCH') picked = route.request().postDataJSON().model;
      await route.fulfill({
        json: { ...saved([{ type: 'text', text: 'Модели готовы.' }]), model: picked },
      });
    });
    await open(page);
    await page.getByRole('button', { name: 'Модель: gpt-5. Сменить модель' }).click();
    const popover = page.locator('[data-slot="popover-content"]');
    await expect(popover.getByRole('option', { name: 'gpt-5', exact: true })).toHaveCount(2);
    await expect(popover.getByRole('button', { name: 'Anthropic', exact: true })).toBeVisible();
    await popover.getByRole('button', { name: 'Anthropic', exact: true }).click();
    await expect(
      popover.getByRole('option', { name: 'claude-sonnet-4', exact: true }),
    ).toBeVisible();
    await expect(popover.getByRole('option', { name: 'gpt-4.1', exact: true })).toHaveCount(0);
    await popover.getByRole('combobox', { name: 'Найти модель' }).fill('gpt-5');
    await expect(popover.getByRole('option', { name: 'gpt-5', exact: true })).toHaveCount(2);
    await page.screenshot({
      path: `test-results/chat/polish-model-search-${narrow ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
    await popover.getByRole('option', { name: 'gpt-5', exact: true }).last().click();
    await expect.poll(() => picked).toEqual({ connectionId: 'spare', modelId: 'gpt-5' });
    await page.getByRole('button', { name: 'Модель: gpt-5. Сменить модель' }).click();
    await page.getByRole('option', { name: 'Использовать по умолчанию', exact: true }).click();
    await expect.poll(() => picked).toBeNull();
    await page.getByRole('button', { name: 'Модель: gpt-5. Сменить модель' }).click();
    await page.screenshot({
      path: `test-results/chat/polish-model-menu-${narrow ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const search = popover.getByRole('combobox', { name: 'Найти модель' });
    await search.press('Home');
    await expect(search).toHaveAttribute('aria-activedescendant', /-default$/);
    await search.press('Enter');
    await expect(popover).toHaveCount(0);
    await page.getByRole('button', { name: 'Модель: gpt-5. Сменить модель' }).click();
    await search.fill('claude');
    await search.press('Enter');
    await expect
      .poll(() => picked)
      .toEqual({ connectionId: 'fixture', modelId: 'claude-sonnet-4' });
  });
}
