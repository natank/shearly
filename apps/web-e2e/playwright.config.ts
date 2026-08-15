import { defineConfig, devices } from '@playwright/test';

const port = 3000;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './src',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node server.mjs',
      cwd: '../../tools/geocoder-stub',
      url: 'http://127.0.0.1:3001/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'pnpm exec tsx src/main.ts',
      cwd: '../api',
      url: 'http://127.0.0.1:4000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm exec next build && pnpm exec next start --port 3000',
      cwd: '../web',
      url: `${baseURL}/en`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
