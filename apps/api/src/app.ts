import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { AppError, toErrorBody } from '@shearly/shared-errors';
import { compose } from './compose.js';

export function createApp() {
  compose();

  const app = new Hono();
  app.get('/health', (c) => c.json({ ok: true }));
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(toErrorBody(err), err.httpStatus as ContentfulStatusCode);
    }
    return c.json({ error: 'INTERNAL', translationKey: 'errors.internal' }, 500);
  });
  return app;
}
