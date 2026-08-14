import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { AppError } from '@shearly/shared-errors';
import { IdentityService } from './identity-service.js';
import { migrateIdentity } from './migrate.js';

const url = process.env.DATABASE_URL;

const config = {
  passwordMinLength: 10,
  sessionTtlHours: 24,
  authRateLimitMax: 10,
  authRateLimitWindowSec: 60,
};

describe('IdentityService', () => {
  const pool = url ? new pg.Pool({ connectionString: url }) : null;
  const identity = pool ? new IdentityService(pool, config) : null;

  beforeAll(async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M1-P2)');
      }
      return;
    }
    await migrateIdentity(url);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('creates a customer session and cannot attach a second role', async () => {
    if (!identity) {
      return;
    }
    const email = `cus-${crypto.randomUUID()}@example.com`;
    const created = await identity.register({
      email,
      password: 'long-enough-password',
      role: 'customer',
      locale: 'he',
      ip: `10.0.0.${Math.floor(Math.random() * 200) + 1}`,
    });
    expect(created.sessionToken).toBeTruthy();
    const me = await identity.accountFromSession(created.sessionToken ?? undefined);
    expect(me?.role).toBe('customer');
    expect(me?.locale).toBe('he');

    const again = await identity.register({
      email,
      password: 'long-enough-password',
      role: 'provider',
      locale: 'en',
      ip: `10.0.1.${Math.floor(Math.random() * 200) + 1}`,
    });
    expect(again.sessionToken).toBeNull();
    const still = await identity.accountFromSession(created.sessionToken ?? undefined);
    expect(still?.role).toBe('customer');
  });

  it('signs in, signs out, and treats unknown emails like bad passwords', async () => {
    if (!identity) {
      return;
    }
    const email = `in-${crypto.randomUUID()}@example.com`;
    const ip = `10.1.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;
    await identity.register({
      email,
      password: 'long-enough-password',
      role: 'provider',
      locale: 'en',
      ip,
    });

    const bad = await identity.signIn({ email, password: 'wrong-password', ip: `${ip}.1` });
    const missing = await identity.signIn({
      email: `missing-${crypto.randomUUID()}@example.com`,
      password: 'wrong-password',
      ip: `${ip}.2`,
    });
    expect(bad.sessionToken).toBeNull();
    expect(missing.sessionToken).toBeNull();

    const ok = await identity.signIn({ email, password: 'long-enough-password', ip: `${ip}.3` });
    expect(ok.sessionToken).toBeTruthy();
    await identity.signOut(ok.sessionToken ?? undefined);
    expect(await identity.accountFromSession(ok.sessionToken ?? undefined)).toBeNull();
  });

  it('rate-limits repeated register attempts from one IP', async () => {
    if (!identity) {
      return;
    }
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    let limited: AppError | null = null;
    for (let i = 0; i < 12; i += 1) {
      try {
        await identity.register({
          email: `rl-${i}-${crypto.randomUUID()}@example.com`,
          password: 'long-enough-password',
          role: 'customer',
          locale: 'en',
          ip,
        });
      } catch (error) {
        if (error instanceof AppError) {
          limited = error;
          break;
        }
        throw error;
      }
    }
    expect(limited?.code).toBe('RATE_LIMITED');
    expect(limited?.httpStatus).toBe(429);
  });
});
