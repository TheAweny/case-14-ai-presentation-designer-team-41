import { readFileSync } from 'node:fs';
import { expect, test, type Locator } from '@playwright/test';
import { signSessionToken } from '../src/lib/session-token';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../packages/contracts/fixtures/${name}.json`, import.meta.url),
      'utf8',
    ),
  ).valid[0].payload;

test.beforeEach(async ({ page, request, baseURL }) => {
  if (!baseURL) throw new Error('UI tests require the fixture base URL.');
  await request.post('http://127.0.0.1:3121/__reset-models');
  await request.post('http://127.0.0.1:3121/__set-templates', {
    data: [
      {
        fileId: '00000000-0000-4000-8000-0000000000e5',
        fileName: 'Проверка меню.pptx',
        name: 'Проверка меню',
        mine: true,
        shared: false,
        createdAt: '2026-10-18T00:00:00Z',
        profile: { designSystem: fixture('DesignSystem'), templateIr: fixture('TemplateIR') },
      },
    ],
  });
  const value = await signSessionToken(
    'chat-e2e-user',
    Date.now() + 3600000,
    'chat-e2e-session-secret',
  );
  await page.context().addCookies([
    { name: 'lct_session', value, url: baseURL },
    { name: 'NEXT_LOCALE', value: 'ru', url: baseURL },
  ]);
});

async function itemStyle(item: Locator) {
  return item.evaluate((el) => {
    const css = getComputedStyle(el);
    return {
      height: el.getBoundingClientRect().height,
      font: css.fontSize,
      radius: css.borderRadius,
      padding: css.padding,
      color: css.color,
    };
  });
}

for (const touch of [false, true]) {
  test(`template action menus share a scale and respect reduced motion (${touch ? 'touch' : 'desktop'})`, async ({
    browser,
    page,
    baseURL,
  }) => {
    // Use a touch-capable context to exercise hover:none instead of only shrinking the viewport.
    const context = touch
      ? await browser.newContext({
          baseURL,
          viewport: { width: 390, height: 844 },
          hasTouch: true,
          isMobile: true,
          storageState: await page.context().storageState(),
        })
      : null;
    const target = context ? await context.newPage() : page;
    await target.emulateMedia({ reducedMotion: 'reduce' });
    await target.goto('/templates');
    const trigger = target.getByRole('button', { name: 'Действия с шаблоном «Проверка меню»' });
    await expect(trigger).toBeAttached();
    if (touch) {
      expect(await target.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
      await expect(trigger).toHaveCSS('opacity', '1');
      await trigger.tap();
    } else {
      const card = target.getByRole('button', { name: /Проверка меню/ }).first();
      await card.focus();
      await expect(trigger).toHaveCSS('opacity', '1');
      await trigger.click();
    }
    const dropdown = target.locator('[data-slot="dropdown-menu-content"]');
    await expect(dropdown).toBeVisible();
    const standard = await itemStyle(
      dropdown.getByRole('menuitem', { name: 'Переименовать', exact: true }),
    );
    await expect(dropdown).toHaveCSS('animation-name', 'none');
    await target.keyboard.press('Escape');

    await target.evaluate(() => {
      const check = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      check.classList.add('status-mark-check');
      const cross = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      cross.classList.add('status-mark-cross');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('data-motion-probe', '');
      svg.append(check, cross);
      document.body.append(svg);
    });
    for (const mark of ['check', 'cross']) {
      const properties = await target
        .locator(`[data-motion-probe] .status-mark-${mark}`)
        .evaluate((el) => getComputedStyle(el).transitionProperty);
      expect(properties).toBe('none');
    }
    await target.locator('[data-motion-probe]').evaluate((el) => el.remove());

    const card = target.locator('[data-slot="context-menu-trigger"]').first();
    if (touch) {
      const box = await card.boundingBox();
      if (!box) throw new Error('The template card must have a visible box.');
      await card.dispatchEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'touch',
        button: 0,
        buttons: 1,
        clientX: box.x + 20,
        clientY: box.y + 20,
      });
    } else {
      await card.click({ button: 'right' });
    }
    const menu = target.locator('[data-slot="context-menu-content"]');
    await expect(menu).toBeVisible();
    expect(
      await itemStyle(menu.getByRole('menuitem', { name: 'Переименовать', exact: true })),
    ).toEqual(standard);
    await expect(menu).toHaveCSS('animation-name', 'none');
    expect(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await target.screenshot({
      path: `test-results/chat/template-menu-${touch ? 'touch' : 'desktop'}.png`,
    });
    await context?.close();
  });
}

test('empty sign in reports one Russian error without native validation or motion', async ({
  page,
}) => {
  await page.context().clearCookies();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  let nativeValidation = 0;
  await page.exposeFunction('validationAttempt', () => {
    nativeValidation++;
  });
  await page.evaluate(() =>
    document.addEventListener(
      'invalid',
      () => {
        void (window as unknown as { validationAttempt(): Promise<void> }).validationAttempt();
      },
      true,
    ),
  );
  const submit = page.getByRole('button', { name: 'Войти', exact: true });
  await submit.click();
  const error = page.locator('form').getByRole('alert');
  await expect(error).toHaveCount(1);
  await expect(error).toHaveText('Введите почту и пароль.');
  expect(nativeValidation).toBe(0);
  await expect(error).toHaveCSS('animation-name', 'none');
  const durations = await submit.evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(durations.split(',').every((item) => parseFloat(item) === 0)).toBe(true);
});

for (const status of [413, 422, 500]) {
  test(`template upload ${status} has a Russian explanation without provider text`, async ({
    page,
  }) => {
    await page.route('**/api/backend/files/template', (route) =>
      route.fulfill({
        status,
        json: { detail: 'Template upload failed: Bearer sk-provider-secret' },
      }),
    );
    await page.goto('/templates');
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Загрузить шаблон', exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: 'broken.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      buffer: Buffer.from('invalid pptx'),
    });
    const error = page.getByRole('main').getByRole('alert');
    await expect(error).toBeVisible();
    await expect(error).toContainText(
      status === 413
        ? 'Шаблон слишком большой'
        : status === 422
          ? 'Не удалось прочитать шаблон'
          : 'сервер не смог его обработать',
    );
    await expect(error).not.toContainText(/Template upload|Bearer|sk-provider|413|422|500/);
  });
}

test('projects retain their appearance with heading levels that do not skip h2', async ({
  page,
  request,
}) => {
  await request.post('http://127.0.0.1:3121/__set-projects', {
    data: [
      {
        projectId: '00000000-0000-4000-8000-0000000000e6',
        name: 'Проверка заголовка',
        appearance: { icon: 'folder', color: 'gray' },
        templateIds: [],
        deckCount: 0,
        updatedAt: '2026-10-18T00:00:00Z',
        pinnedAt: null,
      },
    ],
  });
  await page.goto('/projects');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Проекты' })).toBeVisible();
  await expect(main.getByRole('heading', { level: 2, name: /Проверка заголовка/ })).toBeVisible();
  await expect(main.getByRole('heading', { level: 3 })).toHaveCount(0);
});
