import { Hono, type Context } from 'hono';
import type { AppConfig } from '@shearly/shared-config';
import type { IdentityService } from '@shearly/services-identity';
import type { CatalogService } from '@shearly/services-provider-catalog';
import type { BookingService } from '@shearly/services-booking';
import type { LedgerService } from '@shearly/services-payments';
import {
  transition,
  TransitionError,
  type BookingEvent,
} from '@shearly/domain-booking-state-machine';
import { AuthorizationError, ConflictError, NotFoundError } from '@shearly/shared-errors';
import { requireProvider } from './session.js';
import { executeEffects, type ExecuteEffectsDeps } from './booking-effects.js';

async function requireOwnedBooking(
  input: {
    identity: IdentityService;
    catalog: CatalogService;
    booking: BookingService;
    config: AppConfig;
  },
  c: Context,
) {
  const account = await requireProvider(c, input.identity, input.config);
  const provider = await input.catalog.getByAccount(account.id);
  const bookingId = c.req.param('id');
  if (!bookingId) {
    throw new NotFoundError('booking.notFound');
  }
  const booking = await input.booking.requireById(bookingId);
  if (!provider || booking.provider_id !== provider.id) {
    throw new AuthorizationError('errors.unauthorized');
  }
  return { provider, booking };
}

export function createBookingProviderRoutes(
  input: {
    identity: IdentityService;
    catalog: CatalogService;
    booking: BookingService;
    ledger: LedgerService;
    config: AppConfig;
  } & ExecuteEffectsDeps,
) {
  const routes = new Hono();

  async function act(c: Context, event: BookingEvent, reason?: string) {
    const { provider, booking } = await requireOwnedBooking(input, c);
    let result;
    try {
      result = transition(booking.state, event, {
        clock: new Date(),
        slotStart: booking.slot_start,
        actor: 'provider',
        cancelFullRefundHours: input.config.cancelFullRefundHours,
      });
    } catch (error) {
      if (error instanceof TransitionError) {
        throw new ConflictError(`booking.${error.code.toLowerCase()}`);
      }
      throw error;
    }
    const updated = await input.booking.applyTransition(
      booking.id,
      result.nextState,
      event,
      'provider',
      reason,
    );
    await executeEffects(
      input,
      booking.id,
      provider.id,
      booking.price_minor,
      event,
      result.effects,
    );
    return c.json({ id: updated.id, state: updated.state });
  }

  routes.patch('/bookings/:id/accept', (c) => act(c, 'ProviderAccepts'));

  routes.patch('/bookings/:id/decline', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    return act(c, 'ProviderDeclines', body.reason);
  });

  routes.patch('/bookings/:id/complete', (c) => act(c, 'ProviderCompletes'));

  routes.patch('/bookings/:id/no-show', (c) => act(c, 'ProviderReportsCustomerNoShow'));

  // BOK-006: full refund regardless of timing, no fee ever charged to the
  // provider — the state machine's own ProviderCancels branch enforces
  // that (ReleaseAuth/Refund(100), never a Capture). A distinct path from
  // the customer's PATCH /bookings/:id/cancel (booking-routes.ts) — same
  // path+method for two different actors/events would silently collide,
  // since Hono resolves to whichever route mounted first (design note:
  // this repo mounts booking before bookingProvider in app.ts).
  routes.patch('/bookings/:id/provider-cancel', (c) => act(c, 'ProviderCancels'));

  routes.get('/bookings/:id/provider-view', async (c) => {
    const { booking } = await requireOwnedBooking(input, c);
    // NFR-SEC-005: PENDING never discloses street/access-notes; CONFIRMED+ does.
    if (booking.state === 'PENDING') {
      return c.json({
        id: booking.id,
        state: booking.state,
        slotStart: booking.slot_start,
        slotEnd: booking.slot_end,
        responseDeadline: booking.response_deadline,
      });
    }
    return c.json({
      id: booking.id,
      state: booking.state,
      slotStart: booking.slot_start,
      slotEnd: booking.slot_end,
      fullAddress: booking.address_line,
      accessNotes: booking.access_notes,
    });
  });

  // PAY-004: per-booking gross/commission/net read from the ledger (never
  // derived by summing raw booking rows), plus pending-vs-paid-out balance.
  routes.get('/provider/me/earnings', async (c) => {
    const account = await requireProvider(c, input.identity, input.config);
    const provider = await input.catalog.getByAccount(account.id);
    if (!provider) {
      throw new AuthorizationError('errors.unauthorized');
    }
    const bookings = await input.booking.listByProvider(provider.id);
    const bookingIds = bookings.map((booking) => booking.id);
    const byBooking = await input.ledger.entriesByBooking(bookingIds);

    const entries = bookings
      .filter((booking) => byBooking.has(booking.id))
      .map((booking) => {
        const rows = byBooking.get(booking.id) ?? [];
        const amountFor = (kind: 'gross' | 'commission' | 'net') =>
          rows.find((row) => row.kind === kind)?.amountMinor ?? 0;
        return {
          bookingId: booking.id,
          slotStart: booking.slot_start,
          currency: booking.currency,
          grossMinor: amountFor('gross'),
          commissionMinor: amountFor('commission'),
          netMinor: amountFor('net'),
        };
      });

    const netTotalMinor = entries.reduce((sum, entry) => sum + entry.netMinor, 0);
    const paidOutMinor = await input.ledger.paidOutBalance(account.id);
    const pendingMinor = netTotalMinor - paidOutMinor;

    return c.json({
      commissionRate: input.config.commissionRate,
      pendingMinor,
      paidOutMinor,
      bookings: entries,
    });
  });

  return routes;
}
