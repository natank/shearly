import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { AppError, AuthorizationError } from '@shearly/shared-errors';
import type { AppConfig } from '@shearly/shared-config';
import type { IdentityService } from '@shearly/services-identity';
import type { PublicAccount } from '@shearly/contracts-identity';

export async function requireAccount(
  c: Context,
  identity: IdentityService,
  config: AppConfig,
): Promise<PublicAccount> {
  const account = await identity.accountFromSession(getCookie(c, config.sessionCookieName));
  if (!account) {
    throw new AppError('UNAUTHORIZED', 'errors.unauthorized', 401);
  }
  return account;
}

export async function requireAdmin(
  c: Context,
  identity: IdentityService,
  config: AppConfig,
): Promise<PublicAccount> {
  const account = await requireAccount(c, identity, config);
  if (account.role !== 'admin') {
    throw new AuthorizationError('auth.adminOnly');
  }
  return account;
}

export async function requireCustomer(
  c: Context,
  identity: IdentityService,
  config: AppConfig,
): Promise<PublicAccount> {
  const account = await requireAccount(c, identity, config);
  if (account.role !== 'customer') {
    throw new AuthorizationError('errors.unauthorized');
  }
  return account;
}

export async function requireProvider(
  c: Context,
  identity: IdentityService,
  config: AppConfig,
): Promise<PublicAccount> {
  const account = await requireAccount(c, identity, config);
  if (account.role !== 'provider') {
    throw new AuthorizationError('errors.unauthorized');
  }
  return account;
}
