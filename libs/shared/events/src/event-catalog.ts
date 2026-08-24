/**
 * design §6.4: the typed event catalog. This module only describes shapes —
 * no I/O, no pg import. Each schema that emits events owns its own outbox
 * table (§6.2's grant isolation forbids a shared events schema; see the M5
 * plan's M5-Q1 resolution) — this catalog is what every writer and every
 * consumer agree on, regardless of which schema physically stored the row.
 */

export type BookingStateChangedPayload = {
  bookingId: string;
  fromState: string;
  toState: string;
  event: string;
  actor: 'customer' | 'provider' | 'system' | 'admin';
};

export type BookingCompletedPayload = {
  bookingId: string;
  providerId: string;
  customerId: string;
  grossMinor: number;
  currency: string;
};

export type PaymentCapturedPayload = {
  bookingId: string;
  amountMinor: number;
  currency: string;
};

export type PaymentRefundedPayload = {
  bookingId: string;
  amountMinor: number;
  currency: string;
  reason: string;
};

export type PayoutInitiatedPayload = {
  payoutId: string;
  providerAccountId: string;
  amountMinor: number;
  currency: string;
  triggeredBy: 'admin' | 'schedule';
};

export type ReviewSubmittedPayload = {
  reviewId: string;
  bookingId: string;
  providerId: string;
  rating: number;
};

export type ProviderApprovedPayload = {
  providerId: string;
  accountId: string;
};

export type AvailabilityChangedPayload = {
  accountId: string;
};

export type PayoutAccountReadyPayload = {
  accountId: string;
};

/**
 * OPS-006 (M5-P8b, design §9 M5-Q3): funnel-stage events, page-view/UI-
 * driven rather than booking-state-driven — §6.4's core-events list above
 * doesn't enumerate these. Emitted from the discovery/profile/slots read
 * routes into the same catalog.outbox every other catalog event uses (one
 * event system, not a parallel analytics pipe, per M5-Q3's resolution).
 * Scoped to per-stage counting only — no visitor/session id, since nothing
 * in this plan item asks for full per-visitor funnel attribution and
 * adding one would be new, privacy-sensitive tracking infrastructure
 * beyond OPS-006's stated acceptance criterion (stage counts, not
 * per-visitor journeys).
 */
export type DiscoverySearchedPayload = {
  hasResults: boolean;
};

export type ProfileViewedPayload = {
  providerId: string;
};

export type SlotsViewedPayload = {
  providerId: string;
  serviceId: string;
  slotCount: number;
};

/** The core event catalog design §6.4 names. Each key is the event `type`
 * stored in an outbox row; the value is that event's payload shape. */
export type EventCatalog = {
  BookingStateChanged: BookingStateChangedPayload;
  BookingCompleted: BookingCompletedPayload;
  PaymentCaptured: PaymentCapturedPayload;
  PaymentRefunded: PaymentRefundedPayload;
  PayoutInitiated: PayoutInitiatedPayload;
  ReviewSubmitted: ReviewSubmittedPayload;
  ProviderApproved: ProviderApprovedPayload;
  AvailabilityChanged: AvailabilityChangedPayload;
  PayoutAccountReady: PayoutAccountReadyPayload;
  DiscoverySearched: DiscoverySearchedPayload;
  ProfileViewed: ProfileViewedPayload;
  SlotsViewed: SlotsViewedPayload;
};

export type EventType = keyof EventCatalog;

export type OutboxEventRow<T extends EventType = EventType> = {
  id: string;
  type: T;
  payload: EventCatalog[T];
  created_at: Date;
  dispatched_at: Date | null;
  attempts: number;
};
