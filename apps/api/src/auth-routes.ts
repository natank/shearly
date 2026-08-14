import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerRequestSchema,
  signInRequestSchema,
} from '@shearly/contracts-identity';
import { AppError, ValidationError } from '@shearly/shared-errors';
import type { AppConfig } from '@shearly/shared-config';
import type { IdentityService } from '@shearly/services-identity';

function clientIp(header: string | undefined): string {
  return header?.split(',')[0]?.trim() || '127.0.0.1';
}

function cookieOpts(config: AppConfig) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
    secure: config.nodeEnv === 'production',
    maxAge: Math.floor(config.sessionTtlHours * 60 * 60),
  };
}

export function createAuthRoutes(identity: IdentityService, config: AppConfig) {
  const routes = new Hono();

  routes.post('/auth/register', async (c) => {
    const parsed = registerRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('errors.validation');
    }
    const { sessionToken } = await identity.register({
      ...parsed.data,
      ip: clientIp(c.req.header('x-forwarded-for')),
    });
    if (sessionToken) {
      setCookie(c, config.sessionCookieName, sessionToken, cookieOpts(config));
    }
    return c.json({ ok: true, translationKey: 'auth.registerAccepted' });
  });

  routes.post('/auth/sign-in', async (c) => {
    const parsed = signInRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('errors.validation');
    }
    const { sessionToken } = await identity.signIn({
      ...parsed.data,
      ip: clientIp(c.req.header('x-forwarded-for')),
    });
    if (!sessionToken) {
      return c.json({ ok: false, translationKey: 'auth.invalidCredentials' });
    }
    setCookie(c, config.sessionCookieName, sessionToken, cookieOpts(config));
    return c.json({ ok: true, translationKey: 'auth.signedIn' });
  });

  routes.post('/auth/sign-out', async (c) => {
    await identity.signOut(getCookie(c, config.sessionCookieName));
    deleteCookie(c, config.sessionCookieName, { path: '/' });
    return c.json({ ok: true, translationKey: 'auth.signedOut' });
  });

  routes.post('/auth/password-reset/request', async (c) => {
    const parsed = passwordResetRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('errors.validation');
    }
    await identity.requestPasswordReset({
      ...parsed.data,
      ip: clientIp(c.req.header('x-forwarded-for')),
    });
    return c.json({ ok: true, translationKey: 'auth.resetRequested' });
  });

  routes.post('/auth/password-reset/confirm', async (c) => {
    const parsed = passwordResetConfirmSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('errors.validation');
    }
    await identity.confirmPasswordReset(parsed.data);
    return c.json({ ok: true, translationKey: 'auth.resetCompleted' });
  });

  routes.get('/me', async (c) => {
    const account = await identity.accountFromSession(getCookie(c, config.sessionCookieName));
    if (!account) {
      throw new AppError('UNAUTHORIZED', 'errors.unauthorized', 401);
    }
    return c.json({ account });
  });

  return routes;
}
