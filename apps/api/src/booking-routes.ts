import { Hono } from 'hono';
import type { AppConfig } from '@shearly/shared-config';
import type { IdentityService } from '@shearly/services-identity';
import type { CatalogService } from '@shearly/services-provider-catalog';
import type { AvailabilityService } from '@shearly/services-availability';
import type { BookingService } from '@shearly/services-booking';
import type { AuthorizationService } from '@shearly/services-payments';
import type { ProviderRanker } from '@shearly/domain-ranking';
import { transition, TransitionError } from '@shearly/domain-booking-state-machine';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@shearly/shared-errors';
import { requireCustomer } from './session.js';
import { createBookingSaga } from './booking-saga.js';
import { deriveCancelConsequence } from './cancel-consequence.js';
import { executeEffects, type ExecuteEffectsDeps } from './booking-effects.js';

export function createBookingRoutes(
  input: {
    identity: IdentityService;
    catalog: CatalogService;
    availability: AvailabilityService;
    booking: BookingService;
    authorizations: AuthorizationService;
    ranker: ProviderRanker;
    config: AppConfig;
  } & ExecuteEffectsDeps,
) {
  const routes = new Hono();

  routes.post('/bookings', async (c) => {
    const account = await requireCustomer(c, input.identity, input.config);
    const idempotencyKey = c.req.header('Idempotency-Key');
    if (!idempotencyKey) {
      throw new ValidationError('booking.missingIdempotencyKey');
    }

    const body = (await c.req.json().catch(() => null)) as {
      providerId?: string;
      serviceId?: string;
      addressLine?: string;
      accessNotes?: string;
      lat?: number;
      lng?: number;
      slotStart?: string;
      paymentMethodId?: string;
    } | null;

    if (
      !body?.providerId ||
      !body.serviceId ||
      !body.addressLine ||
      typeof body.lat !== 'number' ||
      typeof body.lng !== 'number' ||
      !body.slotStart ||
      !body.paymentMethodId
    ) {
      throw new ValidationError('errors.validation');
    }

    const slotStart = new Date(body.slotStart);
    if (Number.isNaN(slotStart.getTime())) {
      throw new ValidationError('errors.validation');
    }

    const result = await createBookingSaga(
      {
        catalog: input.catalog,
        availability: input.availability,
        booking: input.booking,
        authorizations: input.authorizations,
        ranker: input.ranker,
        config: input.config,
      },
      {
        customerId: account.id,
        providerId: body.providerId,
        serviceId: body.serviceId,
        addressLine: body.addressLine,
        accessNotes: body.accessNotes ?? '',
        point: { lat: body.lat, lng: body.lng },
        slotStart,
        bookingAttemptId: idempotencyKey,
        paymentMethodId: body.paymentMethodId,
      },
    );

    if ('conflict' in result) {
      return c.json(
        {
          error: 'CONFLICT',
          translationKey: 'booking.slotTaken',
          alternatives: result.alternatives,
        },
        409,
      );
    }

    return c.json(
      {
        id: result.id,
        state: result.state,
        providerId: result.provider_id,
        slotStart: result.slot_start,
        slotEnd: result.slot_end,
        addressLine: result.address_line,
        totalMinor: result.price_minor,
        currency: result.currency,
        responseDeadline: result.response_deadline,
      },
      201,
    );
  });

  routes.get('/bookings/:id', async (c) => {
    const account = await requireCustomer(c, input.identity, input.config);
    const booking = await input.booking.requireById(c.req.param('id'));
    if (booking.customer_id !== account.id) {
      throw new AuthorizationError('errors.unauthorized');
    }
    return c.json({
      id: booking.id,
      state: booking.state,
      providerId: booking.provider_id,
      slotStart: booking.slot_start,
      slotEnd: booking.slot_end,
      addressLine: booking.address_line,
      totalMinor: booking.price_minor,
      currency: booking.currency,
      responseDeadline: booking.response_deadline,
    });
  });

  async function requireOwnBooking(c: Parameters<typeof requireCustomer>[0]) {
    const account = await requireCustomer(c, input.identity, input.config);
    const bookingId = c.req.param('id');
    if (!bookingId) {
      throw new NotFoundError('booking.notFound');
    }
    const booking = await input.booking.requireById(bookingId);
    if (booking.customer_id !== account.id) {
      throw new AuthorizationError('errors.unauthorized');
    }
    return booking;
  }

  function transitionForCancel(booking: Awaited<ReturnType<typeof requireOwnBooking>>) {
    try {
      return transition(booking.state, 'CustomerCancels', {
        clock: new Date(),
        slotStart: booking.slot_start,
        actor: 'customer',
        cancelFullRefundHours: input.config.cancelFullRefundHours,
      });
    } catch (error) {
      if (error instanceof TransitionError) {
        throw new ConflictError(`booking.${error.code.toLowerCase()}`);
      }
      throw error;
    }
  }

  // BOK-005: the exact financial consequence is stated before the customer
  // confirms — never disclosed only afterward. Same transition() call the
  // real cancel below uses, so the disclosed and charged amounts cannot
  // drift (M4 plan §9 M4-Q2).
  routes.get('/bookings/:id/cancel-consequence', async (c) => {
    const booking = await requireOwnBooking(c);
    const result = transitionForCancel(booking);
    return c.json(deriveCancelConsequence(result.effects));
  });

  routes.patch('/bookings/:id/cancel', async (c) => {
    const booking = await requireOwnBooking(c);
    const result = transitionForCancel(booking);
    const updated = await input.booking.applyTransition(
      booking.id,
      result.nextState,
      'CustomerCancels',
      'customer',
    );
    await executeEffects(
      input,
      booking.id,
      booking.provider_id,
      booking.price_minor,
      'customer_cancel',
      result.effects,
    );
    return c.json({ id: updated.id, state: updated.state });
  });

  // BOK-008 (provider-no-show half): customer reports the provider never
  // showed. Only reachable once slot_start has passed (state machine's own
  // guard); full refund, no capture, standing event recorded against the
  // provider. A distinct path from the provider's own PATCH
  // /bookings/:id/no-show (booking-provider-routes.ts, ProviderReportsCustomerNoShow)
  // — same path+method for two different actors/events would silently
  // collide, since Hono resolves to whichever route mounted first.
  routes.patch('/bookings/:id/provider-no-show', async (c) => {
    const booking = await requireOwnBooking(c);
    let result;
    try {
      result = transition(booking.state, 'CustomerReportsProviderNoShow', {
        clock: new Date(),
        slotStart: booking.slot_start,
        actor: 'customer',
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
      'CustomerReportsProviderNoShow',
      'customer',
    );
    await executeEffects(
      input,
      booking.id,
      booking.provider_id,
      booking.price_minor,
      'customer_reports_provider_no_show',
      result.effects,
    );
    return c.json({ id: updated.id, state: updated.state });
  });

  // CUS-006: upcoming (soonest-first) and past, separated. Provider display
  // name and service name are read from catalog for display — booking only
  // owns the price snapshot, not the current catalog labels.
  routes.get('/account/me/bookings', async (c) => {
    const account = await requireCustomer(c, input.identity, input.config);
    const { upcoming, past } = await input.booking.listUpcomingAndPast(account.id);

    async function toCard(row: Awaited<ReturnType<typeof input.booking.getById>>) {
      if (!row) {
        return null;
      }
      const provider = await input.catalog.getById(row.provider_id);
      const service = await input.catalog.getServiceById(row.service_id);
      return {
        id: row.id,
        state: row.state,
        providerId: row.provider_id,
        providerDisplayName: provider?.display_name ?? '',
        serviceName: service?.name ?? '',
        slotStart: row.slot_start,
        slotEnd: row.slot_end,
        addressLine: row.address_line,
        totalMinor: row.price_minor,
        currency: row.currency,
      };
    }

    return c.json({
      upcoming: (await Promise.all(upcoming.map(toCard))).filter(Boolean),
      past: (await Promise.all(past.map(toCard))).filter(Boolean),
    });
  });

  // RAT-001: only a COMPLETED booking may be reviewed, once. The unique
  // index on catalog.reviews.booking_id (M4-P7) is what actually enforces
  // "not twice" under concurrency; this check is the friendly 409 path.
  routes.post('/bookings/:id/review', async (c) => {
    const booking = await requireOwnBooking(c);
    if (booking.state !== 'COMPLETED') {
      throw new ConflictError('rating.notCompleted');
    }
    const body = (await c.req.json().catch(() => null)) as {
      rating?: number;
      body?: string;
    } | null;
    if (!body?.rating) {
      throw new ValidationError('errors.validation');
    }
    const review = await input.catalog.addReview(booking.provider_id, {
      rating: body.rating,
      body: body.body,
      bookingId: booking.id,
    });
    return c.json({ review }, 201);
  });

  return routes;
}
