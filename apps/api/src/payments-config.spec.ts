import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { compose } from './compose.js';

const url = process.env.DATABASE_URL;

describe('GET /payments/config', () => {
  it('returns the configured publishable key, unauthenticated', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    const services = compose();
    try {
      const res = await createApp(services).request('/payments/config');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ publishableKey: services.config.stripePublishableKey });
    } finally {
      await services.pool.end();
    }
  });
});
