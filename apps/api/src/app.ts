import { Hono } from 'hono';
import { compose } from './compose.js';

export function createApp() {
  compose();

  const app = new Hono();
  app.get('/health', (c) => c.json({ ok: true }));
  return app;
}
