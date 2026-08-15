import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  guestDraftSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerRequestSchema,
  signInRequestSchema,
} from '@shearly/contracts-identity';
import { AppError, ValidationError } from '@shearly/shared-errors';
import type { AppConfig } from '@shearly/shared-config';
import {
  decodeGuestDraft,
  encodeGuestDraft,
  type IdentityService,
} from '@shearly/services-identity';
import type { CatalogService } from '@shearly/services-provider-catalog';
import { requireCustomer } from './session.js';
import { geocodeAddress } from './geocode.js';

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

export function createAuthRoutes(
  identity: IdentityService,
  config: AppConfig,
  catalog?: CatalogService,
) {
  const routes = new Hono();

  routes.post('/auth/register', async (c) => {
    const parsed = registerRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('errors.validation');
    }
    const registered = await identity.register({
      ...parsed.data,
      ip: clientIp(c.req.header('x-forwarded-for')),
    });
    if (registered.sessionToken) {
      setCookie(c, config.sessionCookieName, registered.sessionToken, cookieOpts(config));
      if (catalog && registered.role === 'provider' && registered.accountId) {
        await catalog.ensureDraft(registered.accountId);
      }
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

  routes.post('/auth/guest-draft', async (c) => {
    const parsed = guestDraftSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('errors.validation');
    }
    const value = encodeGuestDraft(parsed.data, config.guestDraftSecret, config.guestDraftTtlHours);
    setCookie(c, config.guestDraftCookieName, value, {
      ...cookieOpts(config),
      maxAge: Math.floor(config.guestDraftTtlHours * 60 * 60),
    });
    return c.json({ ok: true, translationKey: 'auth.guestDraftSaved' });
  });

  routes.get('/auth/guest-draft', (c) => {
    const payload = decodeGuestDraft(
      getCookie(c, config.guestDraftCookieName),
      config.guestDraftSecret,
    );
    return c.json({ draft: payload });
  });

  routes.get('/me', async (c) => {
    const account = await identity.accountFromSession(getCookie(c, config.sessionCookieName));
    if (!account) {
      throw new AppError('UNAUTHORIZED', 'errors.unauthorized', 401);
    }
    return c.json({ account });
  });

  routes.get('/account/me/addresses', async (c) => {
    const account = await requireCustomer(c, identity, config);
    return c.json({ addresses: await identity.listAddresses(account.id) });
  });

  routes.post('/account/me/addresses', async (c) => {
    const account = await requireCustomer(c, identity, config);
    const body = (await c.req.json().catch(() => null)) as {
      label?: string;
      line?: string;
      accessNotes?: string;
    } | null;
    if (!body?.label || !body.line) {
      throw new ValidationError('errors.validation');
    }
    const point = await geocodeAddress(config.geocoderUrl, body.line);
    if (!point) {
      throw new ValidationError('discovery.unknownAddress');
    }
    const address = await identity.addAddress(account.id, {
      label: body.label,
      line: body.line,
      lat: point.lat,
      lng: point.lng,
      accessNotes: body.accessNotes,
    });
    return c.json({ address });
  });

  routes.delete('/account/me/addresses/:id', async (c) => {
    const account = await requireCustomer(c, identity, config);
    await identity.deleteAddress(account.id, c.req.param('id'));
    return c.json({ ok: true });
  });

  return routes;
}
