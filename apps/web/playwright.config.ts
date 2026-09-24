import { defineConfig, devices } from '@playwright/test';

/**
 * Сквозные проверки редактора в настоящем браузере: то, что юнит-тесты не видят, — фокус,
 * IndexedDB, полный экран, тач. Сервер поднимается сам (`next dev`) на `E2E_PORT` или уже
 * запущенный берётся как есть.
 *
 * Браузеры — из `PLAYWRIGHT_BROWSERS_PATH`, если он задан; версия `@playwright/test` должна
 * совпадать с их ревизией.
 */
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Один сервер разработки на всех: параллельные вкладки только мешали бы ему компилировать.
  workers: 1,
  reporter: [['list']],
  outputDir: './test-results',
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: {
    command: `yarn next dev --port ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
