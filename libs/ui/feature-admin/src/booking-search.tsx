'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input } from '@shearly/ui-design-system';

type BookingSummary = {
  id: string;
  customerId: string;
  providerId: string;
  serviceId: string;
  state: string;
  priceMinor: number;
  currency: string;
  slotStart: string;
  slotEnd: string;
  addressLine: string;
  createdAt: string;
};

type StateTransition = {
  fromState: string;
  toState: string;
  event: string;
  actor: string;
  reason: string | null;
  createdAt: string;
};

type LedgerEntry = { kind: 'gross' | 'commission' | 'net'; amountMinor: number };

type Operation = {
  key: string;
  kind: string;
  state: string;
  result: unknown;
  createdAt: string;
  updatedAt: string;
};

type Detail = {
  booking: BookingSummary;
  stateTransitions: StateTransition[];
  ledgerEntries: LedgerEntry[];
  operations: Operation[];
};

const STATES = [
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

function formatMinor(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(
    amountMinor / 100,
  );
}

function BookingDetailPanel({ detail }: { detail: Detail }) {
  const t = useTranslations('admin');
  return (
    <div className="flex flex-col gap-3 rounded-md border border-input p-3">
      <p className="text-sm">
        {t('addressLine')}
        {': '}
        {detail.booking.addressLine}
      </p>
      <p className="text-sm">
        {t('total')}
        {': '}
        {formatMinor(detail.booking.priceMinor, detail.booking.currency)}
      </p>

      <div>
        <h3 className="text-sm font-medium">{t('stateHistory')}</h3>
        {detail.stateTransitions.length ? (
          <ul className="flex flex-col gap-1">
            {detail.stateTransitions.map((transition, index) => (
              <li key={`${transition.event}-${index}`} className="text-sm">
                {transition.fromState}
                {' → '}
                {transition.toState}
                {' ('}
                {transition.event}
                {' · '}
                {transition.actor}
                {')'}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">{t('noHistory')}</p>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium">{t('ledger')}</h3>
        {detail.ledgerEntries.length ? (
          <ul className="flex flex-col gap-1">
            {detail.ledgerEntries.map((entry, index) => (
              <li key={`${entry.kind}-${index}`} className="text-sm">
                {entry.kind}
                {': '}
                {formatMinor(entry.amountMinor, detail.booking.currency)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">{t('noLedger')}</p>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium">{t('operations')}</h3>
        {detail.operations.length ? (
          <ul className="flex flex-col gap-1">
            {detail.operations.map((op) => (
              <li key={op.key} className="text-sm">
                {op.kind}
                {' · '}
                {op.state}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">{t('noOperations')}</p>
        )}
      </div>
    </div>
  );
}

function BookingRow({ booking }: { booking: BookingSummary }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);

  async function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && !detail) {
      const res = await fetch(`/api/admin/bookings/${booking.id}`, { credentials: 'include' });
      if (res.ok) {
        setDetail((await res.json()) as Detail);
      }
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-input p-3">
      <button
        type="button"
        className="flex flex-col items-start gap-1 text-start"
        onClick={() => void toggle()}
      >
        <span className="text-sm font-medium">{booking.state}</span>
        <span className="text-sm">{new Date(booking.slotStart).toLocaleString()}</span>
        <span className="text-sm">{booking.addressLine}</span>
      </button>
      {expanded && detail ? <BookingDetailPanel detail={detail} /> : null}
    </li>
  );
}

/** OPS-002: search + expandable detail over the M5-P6 admin API. */
export function BookingSearch() {
  const t = useTranslations('admin');
  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [searched, setSearched] = useState(false);

  async function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    const customerEmail = String(form.get('customerEmail') ?? '').trim();
    const providerId = String(form.get('providerId') ?? '').trim();
    const state = String(form.get('state') ?? '').trim();
    const from = String(form.get('from') ?? '').trim();
    const to = String(form.get('to') ?? '').trim();
    if (customerEmail) {
      params.set('customerEmail', customerEmail);
    }
    if (providerId) {
      params.set('providerId', providerId);
    }
    if (state) {
      params.set('state', state);
    }
    if (from) {
      params.set('from', from);
    }
    if (to) {
      params.set('to', to);
    }
    const res = await fetch(`/api/admin/bookings?${params.toString()}`, {
      credentials: 'include',
    });
    const body = (await res.json()) as { bookings?: BookingSummary[] };
    setBookings(body.bookings ?? []);
    setSearched(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSearch} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('customerEmail')}</span>
          <Input name="customerEmail" type="email" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('providerId')}</span>
          <Input name="providerId" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('state')}</span>
          <select
            name="state"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            defaultValue=""
          >
            <option value="">{t('anyState')}</option>
            {STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('from')}</span>
          <Input name="from" type="date" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('to')}</span>
          <Input name="to" type="date" />
        </label>
        <Button type="submit">{t('search')}</Button>
      </form>

      {searched && !bookings.length ? <p>{t('noResults')}</p> : null}
      {bookings.length ? (
        <ul className="flex flex-col gap-3">
          {bookings.map((booking) => (
            <BookingRow key={booking.id} booking={booking} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
