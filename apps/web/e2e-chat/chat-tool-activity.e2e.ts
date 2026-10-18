import { expect, test, type Page } from '@playwright/test';
import { signSessionToken } from '../src/lib/session-token';

const CHAT = '00000000-0000-4000-8000-0000000000f1';
const USER = '00000000-0000-4000-8000-000000000001';
const MESSAGE = '00000000-0000-4000-8000-000000000002';
const query = 'Tesla Roadster October 2026 official reveal photographs';
const startedAt = Date.now() - 4500;
const presentationErrors = new WeakMap<Page, string[]>();

const research = (status: 'running' | 'failed' | 'done') => ({
  type: 'tool',
  callId: 'research-call',
  name: 'research_topic',
  input: { question: query },
  status,
  phase: 'executing',
  startedAt,
  ...(status !== 'running' ? { finishedAt: startedAt + 1800 } : {}),
  activities: [
    {
      id: 'web-query',
      kind: 'tool',
      name: 'search_web',
      detail: query,
      status: 'done',
      startedAt,
      finishedAt: startedAt + 500,
    },
    {
      id: 'page-read',
      kind: 'tool',
      name: 'fetch_source',
      detail: 'https://example.org/roadster',
      status: 'done',
      startedAt: startedAt + 500,
      finishedAt: startedAt + 900,
    },
    {
      id: 'researcher',
      kind: 'agent',
      name: 'web-researcher',
      detail: 'Compare the reveal claims',
      status,
      startedAt: startedAt + 900,
      ...(status !== 'running' ? { finishedAt: startedAt + 1800 } : {}),
      ...(status === 'failed' ? { error: 'Research provider unavailable' } : {}),
    },
  ],
  ...(status === 'failed' ? { output: { error: 'Research provider unavailable' } } : {}),
});

const message = (status: 'streaming' | 'done' | 'failed' | 'cancelled', parts: unknown[]) => ({
  role: 'assistant',
  id: MESSAGE,
  createdAt: startedAt,
  status,
  parts,
});
const chatDocument = (answer: unknown, running: boolean) => ({
  chatId: CHAT,
  title: 'Действия исследователя',
  projectId: null,
  deckIds: [],
  deckId: null,
  mode: 'plan',
  model: null,
  createdAt: '2026-10-18T00:00:00Z',
  updatedAt: '2026-10-18T00:00:00Z',
  messages: [answer],
  running,
});

test.beforeEach(async ({ context, page }) => {
  const errors: string[] = [];
  presentationErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (entry) => {
    if (entry.type() === 'error' && /MISSING_MESSAGE|IntlError/.test(entry.text())) {
      errors.push(entry.text());
    }
  });
  const value = await signSessionToken(USER, Date.now() + 3600000, 'chat-e2e-session-secret');
  await context.addCookies([
    { name: 'lct_session', value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
});

test.afterEach(async ({ page }) => {
  expect(presentationErrors.get(page) ?? []).toEqual([]);
});

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

for (const narrow of [false, true]) {
  test(`real nested research settles to failure and survives reload (${narrow ? 'mobile reduced' : 'desktop'})`, async ({
    page,
  }) => {
    if (narrow) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
    }
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let settled = false;
    await page.route('**/api/backend/chats/**', async (route) => {
      if (new URL(route.request().url()).pathname.endsWith('/stream')) {
        await gate;
        settled = true;
        await route.fulfill({
          contentType: 'text/event-stream',
          body: [
            { type: 'part', messageId: MESSAGE, index: 0, part: research('failed'), seq: 0 },
            { type: 'message', message: message('failed', [research('failed')]), seq: 1 },
            { type: 'turn-end', seq: 2 },
          ]
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join(''),
        });
      } else
        await route.fulfill({
          json: chatDocument(
            message(settled ? 'failed' : 'streaming', [research(settled ? 'failed' : 'running')]),
            !settled,
          ),
        });
    });
    try {
      await page.goto(`/chats/${CHAT}`);
      const call = page.locator('[data-tool-call="research-call"]');
      await expect(call).toBeVisible();
      await expect(call).toHaveAttribute('data-call-state', 'running');
      await expect(page.getByText(query, { exact: true }).first()).toBeVisible();
      await expect(page.locator('[data-active-researchers="1"]')).toBeVisible();
      await expect(page.locator('[data-activity-id="researcher"]')).toBeVisible();
      await expect(page.getByText('https://example.org/roadster', { exact: true })).toBeVisible();
      await noHorizontalOverflow(page);
      if (narrow) {
        expect(
          await call.evaluate(
            (el) =>
              el
                .getAnimations({ subtree: true })
                .filter((animation) => animation.effect?.getTiming().iterations === Infinity)
                .length,
          ),
        ).toBe(0);
      }
      await page.screenshot({
        path: `test-results/chat/tool-activity-${narrow ? 'mobile' : 'desktop'}-running.png`,
        fullPage: true,
      });
      finish();
      await expect(call).toHaveAttribute('data-call-state', 'failed');
      await expect(page.locator('[data-active-researchers="1"]')).toHaveCount(0);
      const summary = page.locator('.thought-line button[aria-expanded]').first();
      if ((await summary.getAttribute('aria-expanded')) === 'false') await summary.click();
      await expect(
        page.getByText('Research provider unavailable', { exact: true }).first(),
      ).toBeVisible();
      await page.reload();
      await expect(page.locator('[data-active-researchers="1"]')).toHaveCount(0);
      await page.locator('.thought-line button[aria-expanded="false"]').first().click();
      await expect(page.locator('[data-tool-call="research-call"]')).toHaveAttribute(
        'data-call-state',
        'failed',
      );
      await expect(page.locator('[data-activity-id="researcher"]')).toBeVisible();
      await noHorizontalOverflow(page);
      await page.screenshot({
        path: `test-results/chat/tool-activity-${narrow ? 'mobile' : 'desktop'}-failed.png`,
        fullPage: true,
      });
    } finally {
      finish();
    }
  });
}

test('legacy calls and unfinished activities in an ended answer do not invent active agents', async ({
  page,
}) => {
  await page.route(`**/api/backend/chats/${CHAT}`, (route) =>
    route.fulfill({
      json: chatDocument(
        message('cancelled', [
          research('running'),
          {
            type: 'tool',
            callId: 'old-call',
            name: 'search_web',
            input: { query: 'Older saved query' },
            status: 'done',
            output: {},
          },
          {
            type: 'tool',
            callId: 'card-failure',
            name: 'build_deck',
            input: {},
            status: 'failed',
            output: { error: 'The build was rejected' },
          },
        ]),
        false,
      ),
    }),
  );
  await page.goto(`/chats/${CHAT}`);
  await expect(page.locator('[data-active-researchers="1"]')).toHaveCount(0);
  await page.locator('.thought-line button[aria-expanded="false"]').first().click();
  await expect(page.locator('[data-tool-call="research-call"]')).toHaveAttribute(
    'data-call-state',
    'cancelled',
  );
  await expect(page.locator('[data-tool-call="old-call"]')).toBeVisible();
  await expect(page.locator('[data-tool-call="card-failure"]')).toBeVisible();
  await expect(page.locator('[data-tool-call="card-failure"]')).toHaveAttribute(
    'data-call-state',
    'failed',
  );
});

test('public detail is selected from allowed arguments without leaking raw tool payloads', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`**/api/backend/chats/${CHAT}`, (route) =>
    route.fulfill({
      json: chatDocument(
        message('done', [
          {
            type: 'tool',
            callId: 'sensitive-source',
            name: 'fetch_source',
            status: 'done',
            input: {
              url: 'https://alice:VERY_PRIVATE_PASSWORD@example.org/roadster?token=VERY_PRIVATE_TOKEN',
              headers: { authorization: 'VERY_PRIVATE_HEADER' },
            },
            output: { text: 'VERY_PRIVATE_BODY' },
          },
          {
            type: 'tool',
            callId: 'unknown-call',
            name: 'custom_tool',
            status: 'done',
            input: { password: 'VERY_PRIVATE_INPUT' },
            output: { secret: 'VERY_PRIVATE_OUTPUT' },
          },
        ]),
        false,
      ),
    }),
  );
  await page.goto(`/chats/${CHAT}`);
  await page.locator('.thought-line button[aria-expanded="false"]').first().click();
  await expect(page.locator('[data-tool-call="sensitive-source"]')).toBeVisible();
  await expect(page.locator('[data-tool-call="unknown-call"]')).toBeVisible();
  const pageMarkup = await page.locator('body').innerHTML();
  expect(pageMarkup).not.toContain('VERY_PRIVATE');
  await noHorizontalOverflow(page);
});
