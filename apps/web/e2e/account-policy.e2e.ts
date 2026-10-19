import { test, expect, type Page } from '@playwright/test';

test('isolated access: optional policy UI and logout revoke a copied cookie', async ({
  browser,
  page,
  request,
}) => {
  test.skip(
    process.env.RECOVERY_ACCESS !== '1',
    'Requires the disposable API and PostgreSQL stack.',
  );
  const api = process.env.RECOVERY_API ?? 'http://127.0.0.1:13019';
  const service = process.env.RECOVERY_SERVICE_TOKEN ?? 'recovery-isolated-test-service-token-2026';
  const login = await request.post(`${api}/auth/verify`, {
    headers: { 'x-lct-service-token': service },
    data: { email: 'recovery@example.test', password: 'recovery-local-only' },
  });
  expect(login.ok()).toBe(true);
  const auth = await login.json();
  const headers = {
    'x-lct-service-token': service,
    'x-lct-user': auth.account.id,
    'x-lct-session': auth.session.token,
  };
  const email = `access-${Date.now()}@example.test`;
  const created = await request.post(`${api}/users`, {
    headers,
    data: { email, name: 'Access fixture', password: 'fixture-access-password', role: 'user' },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const user = await created.json();
  async function signIn(target: Page, address: string, password: string, next: string) {
    await target.goto(`/login?next=${encodeURIComponent(next)}`);
    await target.getByLabel(/^(Почта|Email)$/).fill(address);
    await target.getByLabel(/^(Пароль|Password)$/).fill(password);
    await target.getByRole('button', { name: /^(Войти|Sign in)$/ }).click();
    await target.waitForURL((url) => url.pathname === '/');
  }
  const personal = await browser.newContext();
  let copied: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    await signIn(page, 'recovery@example.test', 'recovery-local-only', '/?settings=users');
    await page
      .getByLabel(/Ограничения аккаунта|Account limits/, { exact: true })
      .selectOption(user.id);
    const section = page.getByRole('region', {
      name: /Активность и ограничения|Activity and limits/,
    });
    await expect(section.getByText(/Без ограничения|Unlimited/).first()).toBeVisible();
    await section
      .getByLabel(/Успешные генерации|Successful generations/, { exact: true })
      .selectOption('limited');
    await section.getByRole('spinbutton').fill('1');
    await section.getByRole('button', { name: /Сохранить ограничения|Save limits/ }).click();
    await expect(section.getByRole('status')).toHaveText(/Сохранено|Saved/);
    const persisted = await (
      await request.get(`${api}/account-usage/${user.id}`, { headers })
    ).json();
    expect(persisted.effective.generation.limit).toBe(1);
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: '../../runs/recovery-runtime/account-policy-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      section.getByRole('button', { name: /Сохранить ограничения|Save limits/ }),
    ).toBeVisible();
    await section
      .getByRole('button', { name: /Сохранить ограничения|Save limits/ })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: '../../runs/recovery-runtime/account-policy-mobile.png' });
    const target = await personal.newPage();
    await signIn(target, email, 'fixture-access-password', '/?settings=account');
    copied = await browser.newContext({ storageState: await personal.storageState() });
    const stolen = await copied.newPage();
    await stolen.goto('/?settings=account');
    expect((await stolen.request.get('/api/backend/chats')).status()).toBe(200);
    const health = await stolen.request.get('/api/service-status');
    expect(health.status()).toBe(200);
    expect((await health.json()).services).toEqual({ api: 'ok', engine: 'ok', database: 'ok' });
    if (process.env.RECOVERY_HEALTH_FAULTS === '1') {
      const setMode = async (mode: string) => {
        expect(
          (
            await request.post('http://127.0.0.1:13319/__fixture/health', {
              headers: { 'x-recovery-control': 'health-fixture-only' },
              data: mode,
            })
          ).status(),
        ).toBe(204);
      };
      try {
        for (const mode of ['auth-error', 'auth-invalid-json', 'api-down']) {
          await setMode(mode);
          const outage = await stolen.request.get('/api/service-status');
          expect(outage.status(), mode).toBe(200);
          expect((await outage.json()).services).toEqual({
            api: mode === 'api-down' ? 'down' : 'degraded',
            engine: 'unknown',
            database: 'unknown',
          });
          // Trigger the widget without navigating away from the already open application.
          await stolen.evaluate(() => window.dispatchEvent(new Event('online')));
          await expect(
            stolen
              .getByRole('alert')
              .filter({ has: stolen.getByRole('button', { name: /Проверить|Check|Retry/i }) }),
          ).toBeVisible();
        }
      } finally {
        await setMode('healthy');
      }
      const recovered = await stolen.request.get('/api/service-status');
      expect((await recovered.json()).services).toEqual({
        api: 'ok',
        engine: 'ok',
        database: 'ok',
      });
      await stolen.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect(
        stolen
          .getByRole('alert')
          .filter({ has: stolen.getByRole('button', { name: /Проверить|Check|Retry/i }) }),
      ).toHaveCount(0);
      // Other account-dependent actions can navigate this background tab during the outage.
      await target.goto('/?settings=account');
    }
    await target.getByRole('button', { name: /^(Выйти|Sign out)$/ }).click();
    await target.waitForURL('**/login');
    expect((await stolen.request.get('/api/backend/chats')).status()).toBe(401);
    expect((await stolen.request.get('/api/service-status')).status()).toBe(401);
    expect(
      (
        await request.get(`${api}/users`, {
          headers: { 'x-lct-service-token': service, 'x-lct-user': auth.account.id },
        })
      ).status(),
    ).toBe(401);
  } finally {
    await copied?.close();
    await personal.close();
    await request.delete(`${api}/users/${user.id}`, { headers });
  }
});
