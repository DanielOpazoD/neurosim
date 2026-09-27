import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:6620',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev -- --port 6620',
    url: 'http://127.0.0.1:6620',
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
