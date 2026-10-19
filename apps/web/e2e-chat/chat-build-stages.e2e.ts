import { expect, test } from '@playwright/test';
import type { ChatPart, JobEvent } from '@lct/contracts';
import { sessionCookie } from './session';

const CHAT = '00000000-0000-4000-8000-0000000000de';
const USER = '00000000-0000-4000-8000-000000000001';
const RUN = 'stage-history';
type Build = Extract<ChatPart, { type: 'build' }>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Draft = DistributiveOmit<JobEvent, 'schemaVersion' | 'runId' | 'seq' | 'at'>;

test.beforeEach(async ({ context }) => {
  const value = await sessionCookie(USER);
  await context.addCookies([
    { name: 'lct_session', value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
});

for (const { status, missingDone } of [
  { status: 'done', missingDone: false },
  { status: 'done', missingDone: true },
  { status: 'failed', missingDone: false },
  { status: 'cancelled', missingDone: false },
] as const) {
  test(`saved ${status} build distinguishes skipped stages from stages never reached${missingDone ? ' without final event' : ''}`, async ({
    page,
  }) => {
    const drafts: Draft[] = [
      { type: 'stage-started', stage: 'planning' },
      { type: 'stage-finished', stage: 'planning', durationMs: 1000 },
      ...(status === 'done'
        ? ([
            { type: 'stage-started', stage: 'auditing' },
            { type: 'stage-finished', stage: 'auditing', durationMs: 1000 },
            { type: 'stage-started', stage: 'exporting' },
            { type: 'stage-finished', stage: 'exporting', durationMs: 1000 },
            ...(missingDone
              ? []
              : [{ type: 'done', totalMs: 3000, manifestPath: 'manifest.json' } satisfies Draft]),
          ] satisfies Draft[])
        : ([
            { type: 'stage-started', stage: 'auditing' },
            ...(status === 'failed'
              ? ([
                  {
                    type: 'failed',
                    stage: 'auditing',
                    code: 'engine-failed',
                    message: 'Аудит недоступен',
                    retryable: true,
                  },
                ] satisfies Draft[])
              : []),
          ] satisfies Draft[])),
    ];
    const events = drafts.map((draft, seq) => ({
      ...draft,
      seq,
      runId: RUN,
      schemaVersion: 1,
      at: '2026-10-18T00:00:00Z',
    }));
    const build: Build = {
      type: 'build',
      callId: 'build-call',
      buildId: '00000000-0000-4000-8000-000000000004',
      planId: null,
      planRevision: null,
      templateId: '00000000-0000-4000-8000-000000000005',
      templateName: 'Шаблон',
      runId: RUN,
      variantRunIds: [RUN],
      startedAt: 1,
      finishedAt: 3001,
      status,
      error: status === 'failed' ? 'Аудит недоступен' : null,
    };
    await page.route(`**/api/backend/chats/${CHAT}`, (route) =>
      route.fulfill({
        json: {
          chatId: CHAT,
          title: 'Этапы сборки',
          projectId: null,
          deckIds: [],
          deckId: null,
          mode: 'plan',
          model: null,
          createdAt: '2026-10-18T00:00:00Z',
          updatedAt: '2026-10-18T00:00:00Z',
          messages: [{ role: 'assistant', id: USER, status: 'done', createdAt: 2, parts: [build] }],
          running: false,
        },
      }),
    );
    await page.route(`**/api/backend/runs/${RUN}/events?after=-1`, (route) =>
      route.fulfill({ json: events }),
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await page.reload();
      else await page.goto(`/chats/${CHAT}`);
      const disclosure = page.locator('section > button[aria-controls]');
      await expect(disclosure).toBeVisible();
      await disclosure.click();
      const stages = page.getByRole('list', { name: 'Этапы сборки' });
      await expect(stages).toBeVisible();
      await expect(stages.getByText('Очередь', { exact: true })).toHaveCount(0);
      const row = (name: string) => stages.getByRole('listitem').filter({ hasText: name });
      await expect(row('План колоды').locator('.status-mark')).toHaveAttribute(
        'data-status',
        'done',
      );
      for (const name of ['Вёрстка вариантов', 'Превью']) {
        const label = row(name).getByText(status === 'done' ? 'Пропущено' : 'Не начат', {
          exact: true,
        });
        await expect(label).toBeVisible();
        expect(await label.evaluate((el) => el.classList.contains('sr-only'))).toBe(false);
        await expect(row(name).locator('[data-status="done"]')).toHaveCount(0);
      }
      if (status !== 'done') {
        await expect(stages.getByText('Пропущено', { exact: true })).toHaveCount(0);
        await expect(row('Сборка файлов').getByText('Не начат', { exact: true })).toBeVisible();
        await expect(row('Аудит').locator('.status-mark')).toHaveAttribute(
          'data-status',
          status === 'failed' ? 'failed' : 'cancelled',
        );
      } else {
        await expect(row('Аудит').locator('.status-mark')).toHaveAttribute('data-status', 'done');
        await expect(row('Сборка файлов').locator('.status-mark')).toHaveAttribute(
          'data-status',
          'done',
        );
      }
      await expect(stages.locator('[data-status="running"]')).toHaveCount(0);
    }
    await page.screenshot({ path: `test-results/chat/build-stages-${status}.png`, fullPage: true });
  });
}
