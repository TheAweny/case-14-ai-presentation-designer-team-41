import { expect, test } from '@playwright/test';
import type { ChatDocument, ChatPart } from '@lct/contracts';
import { signSessionToken } from '../src/lib/session-token';

const CHAT = '00000000-0000-4000-8000-0000000000c1';
const failures = [
  ['web_http_403', 'Сайт ограничил доступ к этой странице.'],
  ['web_http_401', 'Сайт ограничил доступ к этой странице.'],
  ['web_http_404', 'Страница не найдена.'],
  ['web_http_410', 'Страница не найдена.'],
  ['web_http_429', 'Сайт ограничил частоту открытия этой страницы.'],
  ['web_http_5xx', 'Сайт не смог вернуть эту страницу.'],
  ['web_timeout', 'Сайт не ответил вовремя.'],
] as const;

for (const width of [1280, 390]) {
  test(`fetch failures explain direct and nested denials at ${width}px`, async ({
    context,
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const value = await signSessionToken(
      '00000000-0000-4000-8000-000000000001:session:e2e',
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
    ]);
    const startedAt = Date.now() - 1000;
    const parts: ChatPart[] = failures.map(([code], index) => ({
      type: 'tool',
      callId: code,
      name: 'fetch_source',
      status: 'failed',
      input: { url: 'https://example.org/report/' + String(index) },
      startedAt,
      finishedAt: startedAt + 50,
      output: { code, error: index === 0 ? 'PRIVATE_KEY provider body' : code },
    }));
    parts.push({
      type: 'tool',
      callId: 'research',
      name: 'research_topic',
      status: 'done',
      input: { question: 'Compare reports' },
      startedAt,
      finishedAt: startedAt + 100,
      activities: [
        {
          id: 'nested',
          kind: 'tool',
          name: 'fetch_source',
          status: 'failed',
          detail: 'https://example.org/nested',
          startedAt,
          finishedAt: startedAt + 50,
          error: 'web_http_403',
        },
      ],
    });
    const document: ChatDocument = {
      chatId: CHAT,
      title: 'Fetch failures',
      projectId: null,
      deckIds: [],
      deckId: null,
      mode: 'chat',
      model: null,
      running: false,
      createdAt: '2026-10-18T00:00:00Z',
      updatedAt: '2026-10-18T00:00:00Z',
      messages: [
        {
          role: 'assistant',
          id: '00000000-0000-4000-8000-0000000000c3',
          createdAt: startedAt,
          status: 'done',
          parts,
        },
      ],
    };
    await page.route('**/api/backend/chats/**', (route) => route.fulfill({ json: document }));
    await page.goto(`/chats/${CHAT}`);
    const expand = page.locator('.thought-line button[aria-expanded]').first();
    await expect(expand).toBeVisible();
    if ((await expand.getAttribute('aria-expanded')) === 'false') await expand.click();
    for (const [code, reason] of failures) {
      const chip = page.locator(`[data-tool-call="${code}"]`);
      await expect(chip).toBeVisible();
      await chip.locator(':scope > details > summary').click();
      await expect(chip).toContainText(reason);
      await expect(chip).toHaveAttribute('data-call-state', 'failed');
      await expect(chip.locator('[data-glyph="loading"][data-visible="true"]')).toHaveCount(0);
    }
    const nested = page.locator('[data-activity-id="nested"]');
    await nested.locator(':scope > details > summary').click();
    await expect(nested).toContainText('Сайт ограничил доступ к этой странице.');
    expect(await page.locator('body').textContent()).not.toContain('PRIVATE_KEY');
    expect(await page.locator('body').textContent()).not.toContain('web_http_');
    expect(
      await page.evaluate(() => globalThis.document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}
