import type { AppConfig } from '@shearly/shared-config';
import type { CatalogService } from '@shearly/services-provider-catalog';
import type { AvailabilityService } from '@shearly/services-availability';
import type { BookingRow, BookingService } from '@shearly/services-booking';
import type { AuthorizationService } from '@shearly/services-payments';
import type { ProviderRanker } from '@shearly/domain-ranking';
import { computeResponseDeadline } from '@shearly/domain-booking-state-machine';
import { ConflictError, NotFoundError, ValidationError } from '@shearly/shared-errors';
import { composeDiscovery } from './discovery.js';

export type CreateBookingRequest = {
  customerId: string;
  providerId: string;
  serviceId: string;
  addressLine: string;
  accessNotes: string;
  point: { lat: number; lng: number };
  slotStart: Date;
  bookingAttemptId: string;
  paymentMethodId: string;
};

export type CreateBookingSagaDeps = {
  catalog: CatalogService;
  availability: AvailabilityService;
  booking: BookingService;
  authorizations: AuthorizationService;
  ranker: ProviderRanker;
  config: AppConfig;
};

/**
 * design §8.4: authorize/setup -> insert booking + occupancy in one
 * transaction -> on exclusion violation, cancel the PaymentIntent and
 * surface ConflictError with alternatives. `bookingAttemptId` is the saga id
 * (the client Idempotency-Key on POST /bookings, design §8.2).
 */
export async function createBookingSaga(
  deps: CreateBookingSagaDeps,
  request: CreateBookingRequest,
  now: Date = new Date(),
): Promise<
  BookingRow | { conflict: true; alternatives: Awaited<ReturnType<typeof composeDiscovery>> }
> {
  const provider = await deps.catalog.requirePublic(request.providerId);
  const service = await deps.catalog.getServiceById(request.serviceId);
  if (!service || service.provider_id !== provider.id) {
    throw new NotFoundError('booking.serviceNotFound');
  }
  if (request.slotStart.getTime() <= now.getTime()) {
    throw new ValidationError('booking.slotInPast');
  }

  const slotEnd = new Date(request.slotStart.getTime() + service.duration_minutes * 60_000);
  const responseDeadline = computeResponseDeadline(
    now,
    request.slotStart,
    deps.config.bookingResponseWindowHours,
  );

  // design §8.4 step 1-3: authorize/setup is keyed by bookingAttemptId — the
  // real booking id does not exist yet.
  await deps.authorizations.authorizeOrSetup(
    {
      bookingId: request.bookingAttemptId,
      bookingAttemptId: request.bookingAttemptId,
      amountMinor: service.price_minor,
      currency: deps.config.currency,
      slotStart: request.slotStart,
      now,
    },
    request.paymentMethodId,
  );

  try {
    // design §8.4 step 4: insert booking + occupancy in one transaction.
    const booking = await deps.booking.create({
      customerId: request.customerId,
      providerId: provider.id,
      serviceId: service.id,
      priceMinor: service.price_minor,
      currency: deps.config.currency,
      slotStart: request.slotStart,
      slotEnd,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      addressLine: request.addressLine,
      accessNotes: request.accessNotes,
      responseDeadline,
    });
    // Re-key the authorization from the attempt id to the real booking id so
    // later capture/refund/cancel (which operate on the booking id) find it.
    await deps.authorizations.rekeyToBooking(request.bookingAttemptId, booking.id);
    return booking;
  } catch (error) {
    if (error instanceof ConflictError) {
      // The authorization succeeded but the slot lost the occupancy race
      // (design §8.4 step 4). Cancel the hold and surface alternatives rather
      // than leaving an orphaned authorization on a booking that will never
      // exist — the reconciler is a backstop, not the primary path.
      await deps.authorizations.cancelAuthorization(
        request.bookingAttemptId,
        request.bookingAttemptId,
      );
      const alternatives = await composeDiscovery({
        catalog: deps.catalog,
        availability: deps.availability,
        ranker: deps.ranker,
        config: deps.config,
        point: request.point,
        query: null,
        filters: { service: service.name },
        now,
      });
      return { conflict: true, alternatives };
    }
    throw error;
  }
}
