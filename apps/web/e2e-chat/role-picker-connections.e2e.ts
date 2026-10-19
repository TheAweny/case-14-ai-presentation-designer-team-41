import { expect, test } from '@playwright/test';
import { sessionCookie } from './session';

const API = 'http://127.0.0.1:3121';

const connection = (
  connectionId: string,
  name: string,
  models: string[],
  access: { managed?: boolean; shared?: boolean },
) => ({
  connectionId,
  name,
  preset: 'custom',
  baseUrl: `https://${connectionId}.example.test/v1`,
  hasKey: true,
  keyHint: null,
  managed: access.managed ?? false,
  ...(access.shared === undefined ? {} : { shared: access.shared }),
  lastCheck: { ok: true, at: '2026-10-18T00:00:00Z', models },
});

const settings = (managesShared: boolean) => ({
  connections: [
    connection('server', 'Server models', ['server-model'], { managed: true }),
    connection('team', 'Team models', ['team-model'], { shared: true }),
    connection('mine', 'My models', ['my-model'], { shared: false }),
  ],
  roles: [
    { role: 'writer', kind: 'model', connectionId: 'server', modelId: 'server-model' },
    { role: 'assistant', kind: 'unassigned' },
    { role: 'planner', kind: 'unassigned' },
    { role: 'critic', kind: 'unassigned' },
    { role: 'vision', kind: 'unassigned' },
    { role: 'image', kind: 'disabled' },
  ],
  managesShared,
});

test.beforeEach(async ({ page, baseURL, request }) => {
  await request.post(`${API}/__reset-models`);
  if (!baseURL) throw new Error('Browser tests need the fixture base URL.');
  const value = await sessionCookie('chat-e2e-user');
  await page.context().addCookies([
    { name: 'lct_session', value, url: baseURL },
    { name: 'NEXT_LOCALE', value: 'ru', url: baseURL },
  ]);
});

for (const [who, admin] of [
  ['an administrator', true],
  ['a member', false],
] as const) {
  test(`offers ${who} their own connection next to the shared ones`, async ({ page, request }) => {
    await request.post(`${API}/__set-models`, { data: settings(admin) });
    await page.goto('/?settings=models');
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('button', { name: /Модель для роли «/ })
      .first()
      .click();
    // The picker is the composer's model list: one section header per connection.
    const picker = page.locator('[data-slot="popover-content"]');
    for (const group of ['Server models', 'Team models', 'My models']) {
      await expect(picker.getByText(group, { exact: true })).toBeVisible();
    }
    await picker.getByRole('option', { name: 'my-model', exact: true }).click();
    await expect
      .poll(async () => {
        const saved = (await (await request.get(`${API}/model-settings`)).json()) as {
          roles: { role: string; connectionId?: string; modelId?: string }[];
        };
        return saved.roles.find((role) => role.role === 'writer');
      })
      .toMatchObject({ connectionId: 'mine', modelId: 'my-model' });
  });
}
