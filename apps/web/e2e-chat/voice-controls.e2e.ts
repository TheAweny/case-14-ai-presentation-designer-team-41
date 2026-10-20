import { test, expect } from '@playwright/test';
import { sessionCookie } from './session';

test.beforeEach(async ({ context, request, baseURL }) => {
  await request.post('http://127.0.0.1:3121/__reset-models');
  await request.put('http://127.0.0.1:3121/model-settings/roles', {
    data: { role: 'speech', kind: 'model', connectionId: 'fixture', modelId: 'alpha' },
  });
  const value = await sessionCookie('chat-e2e-user');
  await context.addCookies([
    { name: 'lct_session', value, url: baseURL },
    { name: 'NEXT_LOCALE', value: 'ru', url: baseURL },
  ]);
});

test('dictation can be cancelled during recording and transcription without changing the draft', async ({
  page,
}) => {
  await page.goto('/');
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  const prompt = page.getByRole('textbox', { name: 'О чём новая презентация?' });
  await prompt.fill('Сохранённый черновик');
  await page.getByRole('button', { name: 'Диктовать', exact: true }).click();
  const stop = page.getByRole('button', { name: 'Остановить диктовку', exact: true });
  await expect(stop).toBeVisible();
  await page.screenshot({ path: 'test-results/chat/voice-recording-desktop.png' });
  await page.getByRole('button', { name: 'Отменить диктовку' }).click();
  await expect(page.getByRole('button', { name: 'Диктовать', exact: true })).toBeVisible();
  await expect(prompt).toHaveValue('Сохранённый черновик');
  await page.getByRole('button', { name: 'Диктовать', exact: true }).click();
  await expect(stop).toBeVisible();
  // Let the fake microphone produce a non-empty audio chunk before stopping it.
  await expect(stop).toContainText('0:01', { timeout: 5000 });
  await stop.click();
  await expect(prompt).toHaveAttribute('readonly', '');
  await page.setViewportSize({ width: 390, height: 844 });
  const send = page.getByRole('button', { name: 'Сгенерировать', exact: true });
  expect(
    await send.evaluate((element) => element.getBoundingClientRect().right),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/chat/voice-transcribing-mobile.png' });
  await page.getByRole('button', { name: 'Отменить диктовку' }).click();
  await expect(prompt).not.toHaveAttribute('readonly');
  await expect(page.getByRole('button', { name: 'Диктовать', exact: true })).toBeVisible();
  await expect(prompt).toHaveValue('Сохранённый черновик');
  await page.waitForTimeout(1500);
  await expect(prompt).toHaveValue('Сохранённый черновик');
});

test('microphone permission failure keeps the draft editable', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await page.goto('/');
  const prompt = page.getByRole('textbox', { name: 'О чём новая презентация?' });
  await prompt.fill('Черновик');
  await page.getByRole('button', { name: 'Диктовать', exact: true }).click();
  await expect(page.getByText('Микрофон недоступен.', { exact: true })).toBeVisible();
  await expect(prompt).toHaveValue('Черновик');
  await expect(prompt).not.toHaveAttribute('readonly');
  await expect(page.getByRole('button', { name: 'Отменить диктовку' })).toHaveCount(0);
});
