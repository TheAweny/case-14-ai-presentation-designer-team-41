import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { designSystemSchema, templateIrSchema } from '@lct/contracts';
import { signSessionToken } from '../src/lib/session-token';

const FIXTURE = 'http://127.0.0.1:3121';
const OWN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SHARED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MISSING = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const POTX = 'application/vnd.openxmlformats-officedocument.presentationml.template';

const meta = { source: 'observed' as const, count: 1, share: 1, confidence: 1, parts: [] };

function storedTemplate(input: {
  id: string;
  fileName: string;
  name: string;
  shared: boolean;
  mine: boolean;
  size: number;
}) {
  const profile = {
    designSystem: designSystemSchema.parse({
      schemaVersion: 1,
      templateHash: 'a'.repeat(64),
      aspect: '16:9',
      palette: [
        { role: 'background', hex: 'FFFFFF', meta },
        { role: 'text', hex: '16181D', meta },
      ],
      surfaces: [{ tone: 'light', background: 'FFFFFF', text: '16181D', accent: null, meta }],
      typeFamilies: [{ role: 'primary', font: 'Inter', declared: 'Inter', meta }],
      typeScale: [
        {
          role: 'body',
          font: 'Inter',
          sizePt: 14,
          bold: false,
          italic: false,
          lineSpacing: 1,
          colorRole: 'text',
          meta,
        },
      ],
      grid: {
        slideCx: 12192000,
        slideCy: 6858000,
        marginLeft: 0,
        marginRight: 0,
        marginTop: 0,
        marginBottom: 0,
        columns: 1,
        gutter: 0,
        baseline: 1,
        meta,
      },
      strokes: [],
      radii: [],
      shadows: { present: false, meta },
      protectedZones: [],
      warnings: [],
    }),
    templateIr: templateIrSchema.parse({
      schemaVersion: 1,
      sourceName: input.fileName,
      slideCx: 12192000,
      slideCy: 6858000,
      aspect: '16:9',
      hash: 'b'.repeat(64),
      themeColors: [],
      themeFonts: { majorLatin: 'Inter', minorLatin: 'Inter' },
      masters: [],
      layouts: [],
      slides: [],
      media: [],
      warnings: [],
    }),
  };
  return {
    fileId: input.id,
    fileName: input.fileName,
    name: input.name,
    shared: input.shared,
    mine: input.mine,
    createdAt: '2026-10-18T00:00:00.000Z',
    size: input.size,
    profile,
  };
}

test.beforeEach(async ({ page, baseURL, request }) => {
  await request.post(FIXTURE + '/__reset-models');
  if (!baseURL) throw new Error('Template download browser test requires a base URL.');
  const value = await signSessionToken(
    'chat-e2e-user',
    Date.now() + 3600000,
    'chat-e2e-session-secret',
  );
  await page.context().addCookies([
    { name: 'lct_session', value, url: baseURL },
    { name: 'NEXT_LOCALE', value: 'ru', url: baseURL },
  ]);
  await page.route('**/api/service-status', (route) =>
    route.fulfill({ json: { services: { api: 'ok', engine: 'ok', database: 'ok' } } }),
  );
});

async function openMenu(page: Page, name: string) {
  const button = page.getByRole('button', { name: 'Действия с шаблоном «' + name + '»' });
  await button.hover();
  await button.click();
}

async function bytesOf(download: { path: () => Promise<string | null> }): Promise<Buffer> {
  const filePath = await download.path();
  if (filePath === null) throw new Error('The browser download has no file.');
  return readFileSync(filePath);
}

test('downloads an owned and a shared original, and shows a missing file', async ({
  page,
  request,
}) => {
  const ownBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x71]);
  const sharedBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x02, 0x72]);
  await request.post(FIXTURE + '/__set-templates', {
    data: [
      storedTemplate({
        id: OWN,
        fileName: 'Шаблон квартала.pptx',
        name: 'Квартальный',
        shared: false,
        mine: true,
        size: ownBytes.length,
      }),
      storedTemplate({
        id: SHARED,
        fileName: 'Brand.POTX',
        name: 'Общий бренд',
        shared: true,
        mine: false,
        size: sharedBytes.length,
      }),
      storedTemplate({
        id: MISSING,
        fileName: 'Пропавший.pptx',
        name: 'Пропавший',
        shared: false,
        mine: true,
        size: 12,
      }),
    ],
  });
  await request.post(FIXTURE + '/__set-template-download', {
    data: {
      id: OWN,
      fileName: 'Шаблон квартала.pptx',
      contentType: PPTX,
      bodyBase64: ownBytes.toString('base64'),
    },
  });
  await request.post(FIXTURE + '/__set-template-download', {
    data: {
      id: SHARED,
      fileName: 'Brand.POTX',
      contentType: POTX,
      bodyBase64: sharedBytes.toString('base64'),
    },
  });

  await page.goto('/templates');
  await expect(page.getByRole('heading', { name: 'Шаблоны' })).toBeVisible();
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });

  await openMenu(page, 'Квартальный');
  await expect(page.getByRole('menuitem', { name: 'Переименовать' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Удалить' })).toBeVisible();
  const ownDownload = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Скачать исходный файл' }).click();
  const own = await ownDownload;
  expect(own.suggestedFilename()).toBe('Шаблон квартала.pptx');
  expect((await bytesOf(own)).equals(ownBytes)).toBe(true);

  await openMenu(page, 'Общий бренд');
  await expect(page.getByRole('menuitem', { name: 'Скачать исходный файл' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Переименовать' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Удалить' })).toHaveCount(0);
  const sharedDownload = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Скачать исходный файл' }).click();
  const shared = await sharedDownload;
  expect(shared.suggestedFilename()).toBe('Brand.POTX');
  expect((await bytesOf(shared)).equals(sharedBytes)).toBe(true);

  await openMenu(page, 'Пропавший');
  await page.getByRole('menuitem', { name: 'Скачать исходный файл' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Файл шаблона не найден.' }),
  ).toBeVisible();
});
