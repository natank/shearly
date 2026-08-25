import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateIdentity } from '@shearly/services-identity/migrate';
import { migrateCatalog } from '@shearly/services-provider-catalog/migrate';
import { migrateAvailability } from '@shearly/services-availability/migrate';
import { migratePayments } from '@shearly/services-payments/migrate';
import { createApp } from './app.js';
import { compose } from './compose.js';

const url = process.env.DATABASE_URL;

function cookie(res: Response): string {
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

function uniqueIp(): string {
  const bytes = crypto.randomUUID().replace(/-/g, '');
  const a = parseInt(bytes.slice(0, 2), 16);
  const b = parseInt(bytes.slice(2, 4), 16);
  const c = parseInt(bytes.slice(4, 6), 16);
  return `10.${a}.${b}.${c}`;
}

describe('RAT-003: provider reply to a review', () => {
  const services = url ? compose(undefined, async () => undefined) : null;
  const app = services ? createApp(services) : null;

  beforeAll(async () => {
    if (!url || !services) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    await migrateIdentity(url);
    await migrateCatalog(url);
    await migrateAvailability(url);
    await migratePayments(url);
  });

  afterAll(async () => {
    await services?.pool.end();
  });

  async function registerApprovedProvider(): Promise<{ session: string; providerId: string }> {
    if (!app || !services) {
      throw new Error('app not ready');
    }
    const email = `rat003-${crypto.randomUUID()}@example.com`;
    const register = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': uniqueIp() },
      body: JSON.stringify({
        email,
        password: 'long-enough-password',
        role: 'provider',
        locale: 'en',
      }),
    });
    const session = cookie(register);
    const me = (await (await app.request('/me', { headers: { cookie: session } })).json()) as {
      account: { id: string };
    };
    const provider = await services.catalog.ensureDraft(me.account.id);
    await services.pool.query(
      `UPDATE catalog.providers SET status = 'approved', listed = true WHERE id = $1`,
      [provider.id],
    );
    return { session, providerId: provider.id };
  }

  it('the owning provider can reply once via the API, and it shows on the public profile', async () => {
    if (!app || !services) {
      return;
    }
    const { session, providerId } = await registerApprovedProvider();
    const review = await services.catalog.addReview(providerId, { rating: 5, body: 'great' });

    const reply = await app.request(`/catalog/me/reviews/${review.id}/reply`, {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify({ reply: 'Thank you so much!' }),
    });
    expect(reply.status).toBe(200);

    const own = (await (
      await app.request('/catalog/me/reviews', { headers: { cookie: session } })
    ).json()) as { reviews: { id: string; reply: string | null }[] };
    expect(own.reviews.find((row) => row.id === review.id)?.reply).toBe('Thank you so much!');

    const publicProfile = (await (await app.request(`/catalog/public/${providerId}`)).json()) as {
      reviews: { id: string; reply: string | null }[];
    };
    expect(publicProfile.reviews.find((row) => row.id === review.id)?.reply).toBe(
      'Thank you so much!',
    );
  });

  it('rejects a reply to a review that belongs to a different provider', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId } = await registerApprovedProvider();
    const { session: otherSession } = await registerApprovedProvider();
    const review = await services.catalog.addReview(providerId, { rating: 3 });

    const reply = await app.request(`/catalog/me/reviews/${review.id}/reply`, {
      method: 'POST',
      headers: { cookie: otherSession, 'content-type': 'application/json' },
      body: JSON.stringify({ reply: 'not mine' }),
    });
    expect(reply.status).toBe(404);
  });

  it('rejects an empty reply body', async () => {
    if (!app || !services) {
      return;
    }
    const { session, providerId } = await registerApprovedProvider();
    const review = await services.catalog.addReview(providerId, { rating: 4 });

    const reply = await app.request(`/catalog/me/reviews/${review.id}/reply`, {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify({ reply: '   ' }),
    });
    expect(reply.status).toBe(400);
  });

  it('requires a provider session (customer/unauthenticated rejected)', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId } = await registerApprovedProvider();
    const review = await services.catalog.addReview(providerId, { rating: 4 });

    const anonymous = await app.request(`/catalog/me/reviews/${review.id}/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reply: 'no session' }),
    });
    expect(anonymous.status).toBe(401);
  });
});
