import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { AppError, toErrorBody } from '@shearly/shared-errors';
import { createAuthRoutes } from './auth-routes.js';
import { compose, type AppServices } from './compose.js';

export function createApp(services: AppServices = compose()) {
  const app = new Hono();
  const auth = createAuthRoutes(services.identity, services.config);

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/', auth);
  app.route('/api', auth);
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(toErrorBody(err), err.httpStatus as ContentfulStatusCode);
    }
    return c.json({ error: 'INTERNAL', translationKey: 'errors.internal' }, 500);
  });
  return app;
}
