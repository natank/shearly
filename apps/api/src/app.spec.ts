import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { compose } from './compose.js';

const url = process.env.DATABASE_URL;
const services = url ? compose() : null;

describe('GET /health', () => {
  afterAll(async () => {
    await services?.pool.end();
  });

  it('returns 200 and { ok: true }', async () => {
    if (!services) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    const res = await createApp(services).request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
