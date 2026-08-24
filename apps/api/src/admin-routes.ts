import { Hono } from 'hono';
import type { AppConfig } from '@shearly/shared-config';
import type { IdentityService } from '@shearly/services-identity';
import type { CatalogService } from '@shearly/services-provider-catalog';
import type { BookingService, BookingRow } from '@shearly/services-booking';
import type { AuthorizationService, LedgerService } from '@shearly/services-payments';
import type { BookingState } from '@shearly/domain-booking-state-machine';
import { NotFoundError, ValidationError } from '@shearly/shared-errors';
import { requireAdmin } from './session.js';

const VALID_STATES: readonly BookingState[] = [
  'PENDING',
  'CONFIRMED',
  'DECLINED',
  'EXPIRED',
  'COMPLETED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_PROVIDER',
  'NO_SHOW_CUSTOMER',
  'NO_SHOW_PROVIDER',
];

function isBookingState(value: string): value is BookingState {
  return (VALID_STATES as readonly string[]).includes(value);
}

function toBookingSummary(row: BookingRow) {
  return {
    id: row.id,
    customerId: row.customer_id,
    providerId: row.provider_id,
    serviceId: row.service_id,
    state: row.state,
    priceMinor: row.price_minor,
    currency: row.currency,
    slotStart: row.slot_start,
    slotEnd: row.slot_end,
    addressLine: row.address_line,
    createdAt: row.created_at,
  };
}

/**
 * OPS-002: search + detail + exceptions + retry, over data that already
 * exists correctly from M4/M5-P1 — this file is a read + retry-trigger
 * layer, not a new payments or booking mechanism. The apps/admin UI over
 * this API is a separate PR (M5-P6b), decided at M5-P6 write time — see
 * that section of the plan.
 */
export function createAdminRoutes(input: {
  identity: IdentityService;
  catalog: CatalogService;
  booking: BookingService;
  authorizations: AuthorizationService;
  ledger: LedgerService;
  config: AppConfig;
}) {
  const routes = new Hono();

  routes.get('/admin/bookings', async (c) => {
    await requireAdmin(c, input.identity, input.config);
    const customerEmail = c.req.query('customerEmail') || undefined;
    const providerId = c.req.query('providerId') || undefined;
    const stateParam = c.req.query('state');
    const fromParam = c.req.query('from');
    const toParam = c.req.query('to');

    const state = stateParam && isBookingState(stateParam) ? stateParam : undefined;
    const from = fromParam ? new Date(fromParam) : undefined;
    const to = toParam ? new Date(toParam) : undefined;

    const bookings = await input.booking.search({ customerEmail, providerId, state, from, to });
    return c.json({ bookings: bookings.map(toBookingSummary) });
  });

  routes.get('/admin/bookings/:id', async (c) => {
    await requireAdmin(c, input.identity, input.config);
    const booking = await input.booking.requireById(c.req.param('id'));

    const transitions = await input.booking.history(booking.id);
    const ledgerEntries = await input.ledger.entriesForBooking(booking.id);
    const operations = await input.authorizations.operationsForBooking(booking.id);

    return c.json({
      booking: toBookingSummary(booking),
      stateTransitions: transitions,
      ledgerEntries,
      operations,
    });
  });

  routes.get('/admin/exceptions', async (c) => {
    await requireAdmin(c, input.identity, input.config);
    const exceptions = await input.authorizations.failedOperations();
    return c.json({ exceptions });
  });

  routes.post('/admin/exceptions/:key/retry', async (c) => {
    await requireAdmin(c, input.identity, input.config);
    const key = c.req.param('key');
    await input.authorizations.retryFailedOperation(key);
    return c.json({ ok: true });
  });

  // OPS-003: manual refund outside the automatic cancel-window rules,
  // admin-triggered with a mandatory reason.
  routes.post('/admin/bookings/:id/refund', async (c) => {
    const admin = await requireAdmin(c, input.identity, input.config);
    const booking = await input.booking.requireById(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as {
      amountMinor?: number;
      reason?: string;
    };
    if (typeof body.amountMinor !== 'number' || body.amountMinor <= 0 || !body.reason?.trim()) {
      throw new ValidationError('errors.validation');
    }
    await input.authorizations.manualRefund(
      booking.id,
      body.amountMinor,
      booking.currency,
      body.reason,
      admin.id,
    );
    return c.json({ ok: true });
  });

  // OPS-003: reverses a disputed NO_SHOW_CUSTOMER outcome (refunds the
  // captured amount back to the customer). See reverseNoShow()'s own doc
  // comment for why NO_SHOW_PROVIDER is not reversible.
  routes.post('/admin/bookings/:id/reverse-no-show', async (c) => {
    const admin = await requireAdmin(c, input.identity, input.config);
    const booking = await input.booking.requireById(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    if (!body.reason?.trim()) {
      throw new ValidationError('errors.validation');
    }
    await input.authorizations.reverseNoShow(booking.id, body.reason, admin.id);
    return c.json({ ok: true });
  });

  // OPS-005: manual payout trigger for a provider's current pending
  // balance. Idempotent against a repeat trigger via the client-supplied
  // Idempotency-Key header (same pattern as booking creation).
  routes.post('/admin/providers/:providerId/payout', async (c) => {
    await requireAdmin(c, input.identity, input.config);
    const idempotencyKey = c.req.header('Idempotency-Key');
    if (!idempotencyKey) {
      throw new ValidationError('errors.validation');
    }
    const provider = await input.catalog.getById(c.req.param('providerId'));
    if (!provider) {
      throw new NotFoundError('catalog.providerNotFound');
    }
    const bookings = await input.booking.listByProvider(provider.id);
    const payout = await input.ledger.triggerPayout(
      idempotencyKey,
      provider.account_id,
      bookings.map((booking) => booking.id),
    );
    return c.json({ payout });
  });

  return routes;
}
