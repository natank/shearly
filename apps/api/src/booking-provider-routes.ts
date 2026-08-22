import { Hono, type Context } from 'hono';
import type { AppConfig } from '@shearly/shared-config';
import type { IdentityService } from '@shearly/services-identity';
import type { CatalogService } from '@shearly/services-provider-catalog';
import type { BookingService } from '@shearly/services-booking';
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

  return routes;
}
