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

  return routes;
}
