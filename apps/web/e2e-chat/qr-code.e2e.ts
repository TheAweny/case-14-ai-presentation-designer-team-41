import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { QrCodePart, SlideIr } from '@lct/contracts';
import { signSessionToken } from '../src/lib/session-token';

const qr = createRequire(new URL('../../../packages/pipeline/package.json', import.meta.url))(
  'qrcode',
) as {
  create(input: { data: Buffer; mode: string }[], options: object): { modules: { size: number } };
  toBuffer(input: { data: Buffer; mode: string }[], options: object): Promise<Buffer>;
};
const CHAT = '00000000-0000-4000-8000-0000000000b1';
const DECK = 'run-00000000-0000-4000-8000-0000000000b1';
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../packages/contracts/fixtures/${name}.json`, import.meta.url),
      'utf8',
    ),
  ).valid[0].payload;
const slide = fixture('DeckImportResponse').slides[0] as SlideIr;
const deck = {
  runId: DECK,
  title: 'QR export',
  variant: 'balanced',
  designSystem: fixture('GenerationProfile').designSystem,
  templateIr: fixture('CompositionExportResponse').templateIr,
  slides: [{ ...slide, elements: [] }],
};
const url = 'https://example.org/a?sig=A%2fb+%2B&long=' + 'x'.repeat(130) + '#part';
let part: QrCodePart;
const chat = () => ({
  chatId: CHAT,
  title: 'QR test',
  projectId: null,
  deckId: DECK,
  deckIds: [DECK],
  mode: 'chat',
  model: null,
  createdAt: '2026-10-18T00:00:00Z',
  updatedAt: '2026-10-18T00:00:00Z',
  running: false,
  messages: [
    {
      role: 'assistant',
      id: '00000000-0000-4000-8000-0000000000b2',
      createdAt: 1,
      status: 'done',
      parts: [part],
    },
  ],
});
test.beforeAll(async () => {
  const input = [{ data: Buffer.from(url), mode: 'byte' }];
  const moduleCount = qr.create(input, { errorCorrectionLevel: 'M' }).modules.size;
  const png = await qr.toBuffer(input, { errorCorrectionLevel: 'M', scale: 8, margin: 4 });
  part = {
    type: 'qr-code',
    callId: 'qr-call',
    qrId: '00000000-0000-4000-8000-0000000000b3',
    url,
    pngDataUrl: `data:image/png;base64,${png.toString('base64')}`,
    sha256: createHash('sha256').update(png).digest('hex'),
    moduleCount,
    width: (moduleCount + 8) * 8,
    height: (moduleCount + 8) * 8,
    minSizeEmu: Math.max(900000, (moduleCount + 8) * 38100),
    source: { kind: 'user', messageId: '00000000-0000-4000-8000-0000000000b4' },
    reachability: { status: 'not-checked' },
  };
});
test.beforeEach(async ({ page, request, baseURL }) => {
  if (!baseURL) throw new Error('Expected fixture base URL');
  await request.post('http://127.0.0.1:3121/__reset-models');
  await request.post('http://127.0.0.1:3121/__set-generation-deck', { data: deck });
  const value = await signSessionToken(
    'chat-e2e-user',
    Date.now() + 3600000,
    'chat-e2e-session-secret',
  );
  await page.context().addCookies([
    { name: 'lct_session', value, url: baseURL },
    { name: 'NEXT_LOCALE', value: 'ru', url: baseURL },
  ]);
  await page.route('**/api/backend/chats?**', (route) => route.fulfill({ json: [chat()] }));
  await page.route(`**/api/backend/chats/${CHAT}`, (route) => route.fulfill({ json: chat() }));
});

test('QR preview preserves the exact clickable URL and downloadable PNG on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/chats/${CHAT}`);
  const card = page.locator('[data-qr-code]');
  await expect(card.getByRole('link', { name: url, exact: true })).toHaveAttribute('href', url);
  await expect(card.getByRole('img')).toHaveAttribute('src', part.pngDataUrl);
  await expect(card.getByText('Доступность ссылки не проверена.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Вставить на текущий слайд' })).toBeDisabled();
  const download = card.getByRole('link', { name: 'Скачать PNG' });
  await expect(download).toHaveAttribute('href', part.pngDataUrl);
  await expect(download).toHaveAttribute('download', `qr-${part.qrId}.png`);
  const [file] = await Promise.all([page.waitForEvent('download'), download.click()]);
  expect(file.suggestedFilename()).toBe(`qr-${part.qrId}.png`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('qr-narrow.png') });
});

test('QR inserts only on click, undoes in one step, survives reload and sends exact bytes to export', async ({
  page,
}) => {
  let exported: { slides: SlideIr[]; media: { mediaPart: string; dataUrl: string }[] } | undefined;
  await page.route(`**/api/backend/generation/${DECK}/export`, async (route) => {
    exported = route.request().postDataJSON();
    await route.fulfill({ json: { exportId: 'qr-export', previews: [] } });
  });
  await page.route(`**/api/backend/generation/${DECK}/exports/qr-export/deck.pptx`, (route) =>
    route.fulfill({
      body: 'exported-qr-pptx',
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }),
  );
  await page.goto(`/decks/${DECK}`);
  const card = page.locator('[data-qr-code]');
  const image = page.locator('[data-canvas-slide] [data-kind="image"]');
  await expect(card).toBeVisible();
  await expect(image).toHaveCount(0);
  await card.getByRole('button', { name: 'Вставить на текущий слайд' }).click();
  await expect(image).toHaveCount(1);
  const id = await image.getAttribute('data-element-id');
  if (!id) throw new Error('Expected inserted element id');
  await page.locator('[data-canvas-area]').focus();
  await page.keyboard.press('Control+z');
  await expect(image).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(image).toHaveCount(1);
  await expect(page.locator('[data-save-status="saved"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-draft-restored]')).toBeVisible();
  await expect(image).toHaveCount(1);
  await expect(image).toHaveAttribute('data-element-id', id);
  await expect(image.locator('img')).toHaveAttribute('src', /^blob:/);
  await page.screenshot({ path: test.info().outputPath('qr-desktop-inserted.png') });
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Скачать .pptx', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pptx$/);
  expect(exported?.media).toHaveLength(1);
  expect(exported?.media[0]?.dataUrl).toBe(part.pngDataUrl);
  const inserted = exported?.slides[0]?.elements.find((element) => element.elementId === id);
  expect(inserted).toMatchObject({
    kind: 'image',
    role: 'image',
    sourceShapeId: null,
    fit: 'contain',
    mediaPart: exported?.media[0]?.mediaPart,
  });
  expect(inserted?.box.cx).toBeGreaterThanOrEqual(part.minSizeEmu);
  expect(inserted?.box.cx).toBe(inserted?.box.cy);
  const path = await download.path();
  if (!path) throw new Error('Expected downloaded file');
  expect(readFileSync(path, 'utf8')).toBe('exported-qr-pptx');
});
