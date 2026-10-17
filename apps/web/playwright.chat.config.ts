import { defineConfig, devices } from '@playwright/test';

/** An isolated authenticated browser fixture: never connects to the developer's real API. */
export default defineConfig({
  testDir: './e2e-chat',
  testMatch: '**/*.e2e.ts',
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: [['list']],
  outputDir: './test-results/chat',
  use: { baseURL: 'http://localhost:3120', locale: 'ru-RU', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node --experimental-strip-types e2e-chat/api-fixture.ts',
      url: 'http://127.0.0.1:3121/health',
      timeout: 30000,
      reuseExistingServer: false,
    },
    {
      command: 'yarn next dev --port 3120',
      url: 'http://localhost:3120/login',
      timeout: 180000,
      reuseExistingServer: false,
      env: {
        API_INTERNAL_URL: 'http://127.0.0.1:3121',
        NEXT_DIST_DIR: '.next-chat-e2e',
        AUTH_SECRET: 'chat-e2e-session-secret',
        API_SERVICE_TOKEN: 'chat-e2e-service-token',
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.E2E_BROWSER_CHANNEL,
        // Dictation records from a fake microphone. Playwright takes launch options only here.
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
      },
    },
  ],
});
