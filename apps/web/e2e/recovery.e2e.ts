import { expect, test, type Page } from '@playwright/test';
import { editorReady, freeObject, objectById } from './editor';

test('isolated API: editor revision survives a fresh browser context and exports', async ({
  browser,
  page,
}) => {
  test.skip(!process.env.RECOVERY_RUN_ID, 'Requires an isolated completed recovery build.');
  const runId = process.env.RECOVERY_RUN_ID ?? '';
  async function login(target: Page) {
    await target.goto(`/login?next=/decks/${runId}`);
    await target.getByLabel(/^(Почта|Email)$/).fill('recovery@example.test');
    await target.getByLabel(/^(Пароль|Password)$/).fill('recovery-local-only');
    await target.getByRole('button', { name: /^(Войти|Sign in)$/ }).click();
    await target.waitForURL(`**/decks/${runId}`);
    await editorReady(target);
    await target.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  }
  await login(page);
  const usageResponse = await page.request.get(`/api/backend/generation/${runId}/usage`);
  expect(usageResponse.ok()).toBe(true);
  const usage = await usageResponse.json();
  expect(usage.httpAttempts).toBeGreaterThan(0);
  expect(usage.unknownCostAttempts).toBeGreaterThan(0);
  expect(usage.knownCost).toBeNull();
  const target = freeObject(page);
  const id = (await target.getAttribute('data-element-id')) ?? '';
  await target.click();
  await page.keyboard.press('Delete');
  await expect(objectById(page, id)).toHaveCount(0);
  await expect(page.locator('[data-save-status="saved"]')).toBeVisible();
  const endpoint = `/api/backend/editor/decks/${runId}/snapshot`;
  const saved = await (await page.request.get(endpoint)).json();
  expect(saved.snapshot.revision).toBeGreaterThan(0);
  const context = await browser.newContext();
  try {
    const fresh = await context.newPage();
    await login(fresh);
    await expect(objectById(fresh, id)).toHaveCount(0);
    const restored = await (await fresh.request.get(endpoint)).json();
    expect(restored.snapshot.revision).toBe(saved.snapshot.revision);
    const exported = await fresh.request.post(
      `/api/backend/editor/decks/${runId}/revisions/${saved.snapshot.revision}/export`,
      {
        data: { schemaVersion: 1, format: 'pptx' },
        timeout: 90000,
      },
    );
    expect(exported.ok(), await exported.text()).toBe(true);
    const result = await exported.json();
    expect(result.revision).toBe(saved.snapshot.revision);
    expect(result.contentSha256).toBe(saved.snapshot.contentSha256);
    await fresh.screenshot({ path: '../../runs/recovery-runtime/browser-editor.png' });
  } finally {
    await context.close();
  }
});
