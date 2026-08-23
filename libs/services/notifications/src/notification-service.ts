import pg from 'pg';
import type { BookingStateChangedPayload } from '@shearly/shared-events';
import { templates, type BookingSummary, type Locale } from './templates.js';
import type { NotificationChannel } from './channel.js';

type BookingContext = {
  bookingId: string;
  customerAccountId: string;
  customerEmail: string;
  customerLocale: Locale;
  providerAccountId: string;
  providerEmail: string;
  providerLocale: Locale;
  responseDeadline: Date | null;
  declineReason: string | null;
  summary: BookingSummary;
};

async function loadBookingContext(
  pool: pg.Pool,
  bookingId: string,
): Promise<BookingContext | null> {
  const result = await pool.query<{
    id: string;
    customer_id: string;
    provider_id: string;
    price_minor: number;
    currency: string;
    slot_start: Date;
    response_deadline: Date | null;
    decline_reason: string | null;
    service_name: string;
    customer_email: string;
    customer_locale: Locale;
    provider_account_id: string;
    provider_email: string;
    provider_locale: Locale;
  }>(
    `SELECT
       b.id, b.customer_id, b.provider_id, b.price_minor, b.currency, b.slot_start,
       b.response_deadline, b.decline_reason,
       s.name AS service_name,
       cust.email AS customer_email, cust.locale AS customer_locale,
       p.account_id AS provider_account_id,
       prov.email AS provider_email, prov.locale AS provider_locale
     FROM booking.bookings b
     JOIN catalog.services s ON s.id = b.service_id
     JOIN identity.accounts cust ON cust.id = b.customer_id
     JOIN catalog.providers p ON p.id = b.provider_id
     JOIN identity.accounts prov ON prov.id = p.account_id
     WHERE b.id = $1`,
    [bookingId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    bookingId: row.id,
    customerAccountId: row.customer_id,
    customerEmail: row.customer_email,
    customerLocale: row.customer_locale,
    providerAccountId: row.provider_account_id,
    providerEmail: row.provider_email,
    providerLocale: row.provider_locale,
    responseDeadline: row.response_deadline,
    declineReason: row.decline_reason,
    summary: {
      slotStart: row.slot_start,
      priceMinor: row.price_minor,
      currency: row.currency,
      serviceName: row.service_name,
    },
  };
}

/**
 * NOT-001: the founder-facing consumer of the M5-P1 event bus. One handler
 * per event type, each resolving the right template pair (customer/provider
 * copy differs per NOT-001's matrix) from the minimal outbox payload by
 * looking up the booking's current row — the payload deliberately carries
 * only ids (design §6.4), not denormalized email/locale/amount, so every
 * consumer resolves its own view as of dispatch time.
 *
 * Wiring this into executeEffects()'s `Notify` case — so it actually fires
 * on every real transition — is M5-P4. This PR is the service + templates
 * + one proven handler, per the plan's own "Out" note.
 */
export class NotificationService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly channel: NotificationChannel,
  ) {}

  async handleBookingStateChanged(event: BookingStateChangedPayload): Promise<void> {
    const context = await loadBookingContext(this.pool, event.bookingId);
    if (!context) {
      return;
    }

    switch (event.toState) {
      case 'PENDING':
        if (event.event !== 'created') {
          return;
        }
        await this.sendTo(
          context.customerEmail,
          templates.bookingCreatedCustomer(context.customerLocale, context.summary),
        );
        await this.sendTo(
          context.providerEmail,
          templates.bookingCreatedProvider(
            context.providerLocale,
            context.summary,
            context.responseDeadline ?? context.summary.slotStart,
          ),
        );
        return;

      case 'CONFIRMED':
        await this.sendTo(
          context.customerEmail,
          templates.confirmedCustomer(context.customerLocale, context.summary),
        );
        await this.sendTo(
          context.providerEmail,
          templates.confirmedProvider(context.providerLocale, context.summary),
        );
        return;

      case 'DECLINED':
        await this.sendTo(
          context.customerEmail,
          templates.declinedCustomer(context.customerLocale, context.summary),
        );
        return;

      case 'EXPIRED':
        await this.sendTo(
          context.customerEmail,
          templates.expiredCustomer(context.customerLocale, context.summary),
        );
        await this.sendTo(
          context.providerEmail,
          templates.expiredProvider(context.providerLocale, context.summary),
        );
        return;

      case 'CANCELLED_BY_CUSTOMER': {
        const refundMinor = await this.refundedAmount(event.bookingId);
        await this.sendTo(
          context.customerEmail,
          templates.cancelledByCustomerForCustomer(
            context.customerLocale,
            context.summary,
            refundMinor,
          ),
        );
        await this.sendTo(
          context.providerEmail,
          templates.cancelledByCustomerForProvider(context.providerLocale, context.summary),
        );
        return;
      }

      case 'CANCELLED_BY_PROVIDER':
        await this.sendTo(
          context.customerEmail,
          templates.cancelledByProviderForCustomer(context.customerLocale, context.summary),
        );
        await this.sendTo(
          context.providerEmail,
          templates.cancelledByProviderForProvider(context.providerLocale, context.summary),
        );
        return;

      case 'COMPLETED': {
        const netMinor = await this.netEarnings(event.bookingId);
        await this.sendTo(
          context.customerEmail,
          templates.completedCustomer(context.customerLocale, context.summary),
        );
        await this.sendTo(
          context.providerEmail,
          templates.completedProvider(context.providerLocale, context.summary, netMinor),
        );
        return;
      }

      case 'NO_SHOW_CUSTOMER':
        await this.sendTo(
          context.customerEmail,
          templates.noShowCustomerReportedForCustomer(context.customerLocale, context.summary),
        );
        await this.sendTo(
          context.providerEmail,
          templates.noShowCustomerReportedForProvider(context.providerLocale, context.summary),
        );
        return;

      case 'NO_SHOW_PROVIDER':
        await this.sendTo(
          context.customerEmail,
          templates.noShowProviderReportedForCustomer(context.customerLocale, context.summary),
        );
        await this.sendTo(
          context.providerEmail,
          templates.noShowProviderReportedForProvider(context.providerLocale, context.summary),
        );
        return;

      default:
        return;
    }
  }

  /** The "Refund issued" row of NOT-001's matrix — a distinct notification from the cancellation notice itself. */
  async handlePaymentRefunded(bookingId: string, amountMinor: number): Promise<void> {
    const context = await loadBookingContext(this.pool, bookingId);
    if (!context) {
      return;
    }
    await this.sendTo(
      context.customerEmail,
      templates.refundIssued(context.customerLocale, context.summary, amountMinor),
    );
  }

  private async refundedAmount(bookingId: string): Promise<number> {
    const result = await this.pool.query<{ amount_minor: number }>(
      `SELECT amount_minor FROM payments.ledger WHERE booking_id = $1 AND kind = 'gross' ORDER BY created_at DESC LIMIT 1`,
      [bookingId],
    );
    return Math.abs(result.rows[0]?.amount_minor ?? 0);
  }

  private async netEarnings(bookingId: string): Promise<number> {
    const result = await this.pool.query<{ amount_minor: number }>(
      `SELECT amount_minor FROM payments.ledger WHERE booking_id = $1 AND kind = 'net' ORDER BY created_at DESC LIMIT 1`,
      [bookingId],
    );
    return result.rows[0]?.amount_minor ?? 0;
  }

  private async sendTo(
    to: string,
    rendered: { subject: string; text: string; html: string },
  ): Promise<void> {
    await this.channel.send({
      to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
  }
}
