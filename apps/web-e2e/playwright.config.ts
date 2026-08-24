import { defineConfig, devices } from '@playwright/test';

const port = 3000;
const baseURL = `http://127.0.0.1:${port}`;
const adminPort = 4300;
export const adminBaseURL = `http://127.0.0.1:${adminPort}`;

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
      // NODE_ENV=production is set on the command itself, not inherited
      // from the shell: apps/api's own dotenv.config() (see
      // libs/shared/config/src/load-config.ts) reads .env's own
      // NODE_ENV=development line whenever the ambient shell doesn't
      // already have NODE_ENV set — if that were allowed to propagate here
      // via a shell-wide export instead, apps/api would also see
      // NODE_ENV=production and start marking its session cookie `Secure`,
      // which the browser silently drops over the plain-HTTP localhost
      // this suite runs on. Scoping it to just the Next.js build/start
      // commands keeps apps/api's cookie behavior matching CI, where no
      // .env file exists at all and NODE_ENV is simply unset throughout.
      command: 'NODE_ENV=production pnpm exec next build && pnpm exec next start --port 3000',
      cwd: '../web',
      url: `${baseURL}/en`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: `NODE_ENV=production pnpm exec next build && pnpm exec next start --port ${adminPort}`,
      cwd: '../admin',
      url: `${adminBaseURL}/en`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
