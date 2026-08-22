import { Hono } from 'hono';
import type { AppConfig } from '@shearly/shared-config';
import type { IdentityService } from '@shearly/services-identity';
import type { CatalogService } from '@shearly/services-provider-catalog';
import type { AvailabilityService } from '@shearly/services-availability';
import type { BookingService } from '@shearly/services-booking';
import type { AuthorizationService } from '@shearly/services-payments';
import type { ProviderRanker } from '@shearly/domain-ranking';
import { AuthorizationError, ValidationError } from '@shearly/shared-errors';
import { requireCustomer } from './session.js';
import { createBookingSaga } from './booking-saga.js';

export function createBookingRoutes(input: {
  identity: IdentityService;
  catalog: CatalogService;
  availability: AvailabilityService;
  booking: BookingService;
  authorizations: AuthorizationService;
  ranker: ProviderRanker;
  config: AppConfig;
}) {
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

  return routes;
}
