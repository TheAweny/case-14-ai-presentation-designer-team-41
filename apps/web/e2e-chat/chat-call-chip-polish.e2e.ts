import { expect, test, type Page } from '@playwright/test';
import type {
  AssistantChatMessage,
  ChatDocument,
  ChatEvent,
  ChatMessage,
  ChatPart,
  ChatToolActivity,
} from '@lct/contracts';
import { sessionCookie } from './session';

const CHAT = '00000000-0000-4000-8000-0000000000c1';
const USER = '00000000-0000-4000-8000-000000000001';
const USER_MESSAGE = '00000000-0000-4000-8000-0000000000c2';
const ANSWER = '00000000-0000-4000-8000-0000000000c3';
const startedAt = Date.now() - 6200;
const presentationErrors = new WeakMap<Page, string[]>();

const longRuQuery =
  'официальные фотографии Tesla Roadster октябрь 2026 презентация на закрытом показе с длинным описанием деталей кузова и интерьера';
const longEnUrl =
  'https://example.org/press/tesla-roadster-october-2026-official-reveal-photographs-with-extended-path/gallery?view=full';
const longAssetQuery =
  'Tesla Roadster October 2026 official reveal photographs high-resolution studio lighting product stills';

const userMessage: ChatMessage = {
  role: 'user',
  id: USER_MESSAGE,
  text: 'Собери факты по Roadster и посчитай бюджет',
  attachments: [],
  mode: 'plan',
  createdAt: startedAt - 1000,
};

function activity(
  id: string,
  name: string,
  status: ChatToolActivity['status'],
  extra: Partial<ChatToolActivity> = {},
): ChatToolActivity {
  return {
    id,
    kind: extra.kind ?? 'tool',
    name,
    status,
    startedAt: extra.startedAt ?? startedAt,
    ...(extra.finishedAt !== undefined ? { finishedAt: extra.finishedAt } : {}),
    ...(extra.detail !== undefined ? { detail: extra.detail } : {}),
    ...(extra.error !== undefined ? { error: extra.error } : {}),
    ...(extra.parentId !== undefined ? { parentId: extra.parentId } : {}),
  };
}

function research(status: 'running' | 'done'): Extract<ChatPart, { type: 'tool' }> {
  const nestedStatus: ChatToolActivity['status'] = status === 'running' ? 'failed' : 'cancelled';
  return {
    type: 'tool',
    callId: 'research-call',
    name: 'research_topic',
    input: { question: longRuQuery },
    status,
    phase: 'executing',
    startedAt,
    ...(status !== 'running' ? { finishedAt: startedAt + 2400 } : {}),
    activities: [
      activity('topic-search', 'search_web', 'done', {
        detail: longRuQuery,
        finishedAt: startedAt + 400,
      }),
      activity('page-read', 'fetch_source', 'failed', {
        detail: longEnUrl,
        error: 'operation_failed',
        startedAt: startedAt + 400,
        finishedAt: startedAt + 900,
      }),
      activity('researcher', 'web-researcher', status === 'running' ? 'running' : 'done', {
        kind: 'agent',
        detail: 'Сравнить заявления о показе',
        startedAt: startedAt + 900,
        ...(status !== 'running' ? { finishedAt: startedAt + 2400 } : {}),
      }),
      activity('nested-page', 'fetch_source', nestedStatus, {
        parentId: 'researcher',
        detail: longEnUrl,
        error: 'operation_failed',
        startedAt: startedAt + 1100,
        finishedAt: startedAt + 1600,
      }),
    ],
  };
}

function calculate(): Extract<ChatPart, { type: 'tool' }> {
  return {
    type: 'tool',
    callId: 'calc-call',
    name: 'calculate',
    input: {},
    status: 'done',
    phase: 'executing',
    startedAt: startedAt + 2500,
    finishedAt: startedAt + 2700,
    output: { result: 1920 },
  };
}

function searchAssets(): Extract<ChatPart, { type: 'tool' }> {
  return {
    type: 'tool',
    callId: 'assets-call',
    name: 'search_assets',
    input: { query: longAssetQuery },
    status: 'failed',
    phase: 'executing',
    startedAt: startedAt + 2800,
    finishedAt: startedAt + 3100,
    output: { error: 'web_budget_exhausted' },
  };
}

function assistant(running: boolean): AssistantChatMessage {
  return {
    role: 'assistant',
    id: ANSWER,
    createdAt: startedAt,
    status: running ? 'streaming' : 'done',
    parts: running ? [research('running')] : [research('done'), calculate(), searchAssets()],
  };
}

function chatDocument(running: boolean): ChatDocument {
  return {
    chatId: CHAT,
    title: 'Минималистичные tool chips',
    projectId: null,
    deckIds: [],
    deckId: null,
    mode: 'plan',
    model: null,
    createdAt: '2026-10-18T00:00:00Z',
    updatedAt: '2026-10-18T00:00:00Z',
    messages: [userMessage, assistant(running)],
    running,
  };
}

function sse(events: ChatEvent[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}

test.beforeEach(async ({ context, page }) => {
  const errors: string[] = [];
  presentationErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (entry) => {
    if (entry.type() === 'error' && /MISSING_MESSAGE|IntlError/.test(entry.text())) {
      errors.push(entry.text());
    }
  });
  const value = await sessionCookie(USER);
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

async function keepThoughtLineOpen(page: Page) {
  const summary = page.locator('.thought-line button[aria-expanded]').first();
  await expect(summary).toBeVisible();
  if ((await summary.getAttribute('aria-expanded')) === 'false') await summary.click();
  await expect(summary).toHaveAttribute('aria-expanded', 'true');
}

async function expandChipDetails(page: Page) {
  const labeled = page.locator(
    '[data-tool-call] summary[aria-label], [data-activity-id] summary[aria-label]',
  );
  const count = await labeled.count();
  for (let index = 0; index < count; index += 1) {
    const summary = labeled.nth(index);
    const parent = summary.locator('xpath=ancestor::details[1]');
    if (!(await parent.evaluate((el) => (el as HTMLDetailsElement).open))) await summary.click();
  }
  const nested = page.locator('[data-tool-call] button[aria-expanded="false"]');
  while ((await nested.count()) > 0) await nested.first().click();
}

async function expectGlyph(root: ReturnType<Page['locator']>, state: string) {
  const glyph = root.locator('[data-glyph-state]').first();
  await expect(glyph).toHaveAttribute('data-glyph-state', state);
  await expect(glyph.locator('[data-visible]')).toHaveCount(3);
  await expect(glyph.locator('[data-visible="true"]')).toHaveCount(1);
  await expect(glyph.locator('[data-visible="false"]')).toHaveCount(2);
}

async function expectExpandedGroup(page: Page) {
  await keepThoughtLineOpen(page);
  const researchChip = page.locator('[data-tool-call="research-call"]');
  const calcChip = page.locator('[data-tool-call="calc-call"]');
  const assetsChip = page.locator('[data-tool-call="assets-call"]');
  await expect(researchChip).toBeVisible();
  await expect(calcChip).toBeVisible();
  await expect(assetsChip).toBeVisible();
  await expect(page.locator('[data-activity-id="topic-search"]')).toBeVisible();
  await expect(page.locator('[data-activity-id="page-read"]')).toBeVisible();
  await expect(page.locator('[data-activity-id="researcher"]')).toBeVisible();
  await expect(page.locator('[data-activity-id="nested-page"]')).toBeVisible();
  await expect(researchChip).toHaveAttribute('data-call-state', 'done');
  await expect(calcChip).toHaveAttribute('data-call-state', 'done');
  await expect(assetsChip).toHaveAttribute('data-call-state', 'failed');
  await expect(page.locator('[data-activity-id="page-read"]')).toHaveAttribute(
    'data-call-state',
    'failed',
  );
  await expect(page.locator('[data-activity-id="nested-page"]')).toHaveAttribute(
    'data-call-state',
    'cancelled',
  );
  await expectGlyph(researchChip, 'done');
  await expectGlyph(calcChip, 'done');
  await expectGlyph(assetsChip, 'failed');
  await expect(page.getByText('operation_failed', { exact: true })).toHaveCount(0);
  await expect(page.getByText('web_budget_exhausted', { exact: true })).toBeHidden();
  await expect(
    page.locator('summary[aria-label="Подробности действия: fetch_source"]').first(),
  ).toBeVisible();
  await expect(
    page.locator('summary[aria-label="Подробности действия: research_topic"]'),
  ).toHaveCount(1);
  await expect(page.getByText('operation_failed', { exact: true })).toHaveCount(0);
}

async function expectChipSurface(page: Page) {
  const researchChip = page.locator('[data-tool-call="research-call"]');
  const styles = await researchChip.evaluate((el) => {
    const child = el.querySelector('[data-activity-id]');
    const row = child?.querySelector('div') ?? child;
    const childStyle = child ? getComputedStyle(child) : null;
    const rowStyle = row ? getComputedStyle(row) : null;
    return {
      rootWidth: el.getBoundingClientRect().width,
      viewport: window.innerWidth,
      rootFit: getComputedStyle(el).width,
      childBackground: childStyle?.backgroundColor ?? '',
      childBorderWidth: childStyle?.borderTopWidth ?? '',
      rowBackground: rowStyle?.backgroundColor ?? '',
      rowBorderWidth: rowStyle?.borderTopWidth ?? '',
      childClass: child instanceof HTMLElement ? child.className : '',
    };
  });
  expect(styles.rootWidth).toBeLessThan(styles.viewport);
  expect(styles.childClass).toMatch(/childRow/);
  expect(styles.childBackground).toMatch(/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/i);
  expect(Number.parseFloat(styles.childBorderWidth) === 0).toBe(true);
  expect(styles.rowBackground).toMatch(/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/i);
  expect(Number.parseFloat(styles.rowBorderWidth) === 0).toBe(true);
}

async function expectEqualChipWidths(page: Page) {
  const metrics = await page.evaluate(() => {
    const list = document.querySelector('[data-active-agents] ul');
    const research = document.querySelector('[data-tool-call="research-call"]');
    const calc = document.querySelector('[data-tool-call="calc-call"]');
    const assets = document.querySelector('[data-tool-call="assets-call"]');
    if (!list || !research || !calc || !assets) return null;
    return {
      listWidth: list.getBoundingClientRect().width,
      viewport: window.innerWidth,
      research: surface(research),
      calc: surface(calc),
      assets: surface(assets),
      nested: surface(research.querySelector('[data-activity-id="nested-page"]')),
      parent: surface(research.querySelector('[data-activity-id="researcher"]')),
      topic: surface(research.querySelector('[data-activity-id="topic-search"]')),
    };

    function surface(root: Element | null) {
      if (!root) return null;
      const details = root.querySelector(':scope > details');
      const summary = details?.querySelector(':scope > summary') ?? null;
      const host = summary ?? root;
      const row =
        Array.from(host.children).find(
          (node) =>
            node instanceof HTMLElement && Boolean(node.querySelector('time, [data-glyph-state]')),
        ) ?? host.querySelector('div');
      const time = row?.querySelector('time') ?? null;
      const rowBox = row?.getBoundingClientRect();
      const timeBox = time?.getBoundingClientRect();
      return {
        hasDetails: Boolean(details),
        summaryWidth: summary?.getBoundingClientRect().width ?? 0,
        rowWidth: rowBox?.width ?? 0,
        rowRight: rowBox?.right ?? 0,
        timeRight: timeBox?.right ?? 0,
        paddingRight: row ? Number.parseFloat(getComputedStyle(row).paddingRight) : 0,
      };
    }
  });
  expect(metrics).not.toBeNull();
  if (!metrics) return;
  expect(metrics.research).not.toBeNull();
  expect(metrics.calc).not.toBeNull();
  expect(metrics.assets).not.toBeNull();
  if (!metrics.research || !metrics.calc || !metrics.assets) return;
  expect(Math.abs(metrics.research.rowWidth - metrics.calc.rowWidth)).toBeLessThan(1);
  expect(Math.abs(metrics.research.rowWidth - metrics.assets.rowWidth)).toBeLessThan(1);
  expect(metrics.research.summaryWidth).toBeGreaterThan(0);
  expect(Math.abs(metrics.research.summaryWidth - metrics.research.rowWidth)).toBeLessThan(1);
  expect(Math.abs(metrics.assets.summaryWidth - metrics.assets.rowWidth)).toBeLessThan(1);
  expect(metrics.calc.hasDetails).toBe(false);
  expect(metrics.research.rowWidth).toBeGreaterThan(metrics.listWidth * 0.98);
  expect(Math.abs(metrics.research.rowWidth - metrics.listWidth)).toBeLessThan(1);
  expect(metrics.research.rowWidth).toBeLessThanOrEqual(metrics.viewport);
  expect(metrics.calc.timeRight).toBeGreaterThan(0);
  expect(metrics.research.timeRight).toBeGreaterThan(0);
  expect(metrics.assets.timeRight).toBeGreaterThan(0);
  expect(metrics.calc.rowRight - metrics.calc.timeRight).toBeGreaterThanOrEqual(0);
  expect(
    Math.abs(metrics.calc.rowRight - metrics.calc.timeRight - metrics.calc.paddingRight),
  ).toBeLessThan(1);
  expect([7, 10]).toContain(metrics.calc.paddingRight);
  expect(Math.abs(metrics.research.timeRight - metrics.assets.timeRight)).toBeLessThan(1);
  expect(
    Math.abs(
      metrics.research.rowRight -
        metrics.research.timeRight -
        (metrics.assets.rowRight - metrics.assets.timeRight),
    ),
  ).toBeLessThan(1);
  expect(metrics.research.rowRight - metrics.research.timeRight).toBeGreaterThan(
    metrics.calc.paddingRight,
  );
  expect(metrics.nested).not.toBeNull();
  expect(metrics.parent).not.toBeNull();
  expect(metrics.topic).not.toBeNull();
  if (metrics.nested && metrics.parent && metrics.topic) {
    expect(metrics.nested.rowRight).toBeLessThanOrEqual(metrics.parent.rowRight + 0.5);
    expect(metrics.parent.rowRight).toBeLessThanOrEqual(metrics.topic.rowRight + 0.5);
    expect(metrics.topic.rowRight).toBeLessThanOrEqual(metrics.research.rowRight + 0.5);
    expect(metrics.parent.rowWidth).toBeGreaterThan(metrics.nested.rowWidth);
  }
}

for (const narrow of [false, true]) {
  test(`minimal tool chips keep the expanded group and settle without remount (${narrow ? 'mobile' : 'desktop'})`, async ({
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
          body: sse([
            { type: 'part', messageId: ANSWER, index: 0, part: research('done'), seq: 0 },
            { type: 'part', messageId: ANSWER, index: 1, part: calculate(), seq: 1 },
            { type: 'part', messageId: ANSWER, index: 2, part: searchAssets(), seq: 2 },
            { type: 'message', message: assistant(false), seq: 3 },
            { type: 'turn-end', seq: 4 },
          ]),
        });
      } else await route.fulfill({ json: chatDocument(!settled) });
    });
    try {
      await page.goto(`/chats/${CHAT}`);
      const call = page.locator('[data-tool-call="research-call"]');
      await expect(call).toBeVisible();
      await expect(call).toHaveAttribute('data-call-state', 'running');
      await expect(page.locator('.thought-line button[aria-expanded]').first()).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      await expect(page.locator('[data-activity-id="topic-search"]')).toHaveAttribute(
        'data-call-state',
        'done',
      );
      await expect(page.locator('[data-activity-id="page-read"]')).toHaveAttribute(
        'data-call-state',
        'failed',
      );
      await expect(page.locator('[data-activity-id="researcher"]')).toHaveAttribute(
        'data-call-state',
        'running',
      );
      await expectGlyph(call, 'running');
      await expect(page.getByText('operation_failed', { exact: true })).toHaveCount(0);
      await expect(page.locator('[data-tool-call="calc-call"]')).toHaveCount(0);
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
      const node = await call.elementHandle();
      expect(node).not.toBeNull();
      await page.screenshot({
        path: `test-results/chat/call-chip-polish-${narrow ? 'mobile' : 'desktop'}-running.png`,
        fullPage: true,
      });
      finish();
      await expect(call).toHaveAttribute('data-call-state', 'done');
      expect(await call.evaluate((el, original) => el === original, node)).toBe(true);
      await expect(page.locator('.thought-line button[aria-expanded]').first()).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      const sheet = await page.evaluate(() => {
        const rules: string[] = [];
        for (const style of Array.from(document.styleSheets)) {
          let items: CSSRuleList;
          try {
            items = style.cssRules;
          } catch {
            continue;
          }
          for (const rule of Array.from(items)) rules.push(rule.cssText);
        }
        return rules.some(
          (text) => /transition/i.test(text) && /transform/i.test(text) && /opacity/i.test(text),
        );
      });
      expect(sheet).toBe(true);
      await expectExpandedGroup(page);
      await expectChipSurface(page);
      await expectEqualChipWidths(page);
      await noHorizontalOverflow(page);
      await page.screenshot({
        path: `test-results/chat/call-chip-polish-${narrow ? 'mobile' : 'desktop'}-done.png`,
        fullPage: true,
      });
      await expandChipDetails(page);
      await expectEqualChipWidths(page);
      await expect(page.locator('[data-tool-call="assets-call"]')).toContainText(
        'Достигнут лимит этого типа веб-запросов',
      );
      await expect(page.getByText('web_budget_exhausted', { exact: true })).toHaveCount(0);
    } finally {
      finish();
    }
  });
}
