'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@shearly/ui-design-system';

type ProviderBookingRow = {
  id: string;
  state: string;
  slotStart: string;
  slotEnd: string;
  responseDeadline?: string;
  fullAddress?: string;
  accessNotes?: string;
};

function formatSlot(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

async function act(path: string, body?: unknown): Promise<boolean> {
  const res = await fetch(`/api${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.ok;
}

function BookingRow({
  booking,
  onChanged,
}: {
  booking: ProviderBookingRow;
  onChanged: () => void;
}) {
  const t = useTranslations('provider');
  const locale = useLocale();
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  async function run(path: string, body?: unknown) {
    setPending(true);
    setErrorKey(null);
    const ok = await act(path, body);
    setPending(false);
    if (!ok) {
      setErrorKey('bookingActionFailed');
      return;
    }
    onChanged();
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-input p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span>{formatSlot(booking.slotStart, locale)}</span>
        <span>{booking.state}</span>
      </div>
      {booking.fullAddress ? (
        <>
          <span>{booking.fullAddress}</span>
          {booking.accessNotes ? <span>{booking.accessNotes}</span> : null}
        </>
      ) : null}
      {errorKey ? <span>{t(errorKey as 'bookingActionFailed')}</span> : null}
      {booking.state === 'PENDING' ? (
        <div className="flex gap-2">
          <Button
            type="button"
            disabled={pending}
            onClick={() => run(`/bookings/${booking.id}/accept`)}
          >
            {t('accept')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => run(`/bookings/${booking.id}/decline`, {})}
          >
            {t('decline')}
          </Button>
        </div>
      ) : null}
      {booking.state === 'CONFIRMED' ? (
        <div className="flex gap-2">
          <Button
            type="button"
            disabled={pending}
            onClick={() => run(`/bookings/${booking.id}/complete`)}
          >
            {t('complete')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => run(`/bookings/${booking.id}/no-show`)}
          >
            {t('reportCustomerNoShow')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => run(`/bookings/${booking.id}/provider-cancel`)}
          >
            {t('cancelBooking')}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** QCF-013: the click-through surface for accept/decline/complete/no-show/
 * provider-cancel — those routes existed API-only until now. PENDING rows
 * never show fullAddress/accessNotes (NFR-SEC-005's DTO gate, enforced
 * server-side; this component just doesn't render fields that aren't there). */
export function ProviderBookings() {
  const t = useTranslations('provider');
  const [bookings, setBookings] = useState<ProviderBookingRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    const res = await fetch('/api/provider/me/bookings', { credentials: 'include' });
    if (res.ok) {
      const body = (await res.json()) as { bookings: ProviderBookingRow[] };
      setBookings(body.bookings);
    }
    setLoaded(true);
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (!loaded) {
    return <p className="text-sm">{t('loading')}</p>;
  }

  return (
    <section className="flex flex-col gap-4 rounded-md border border-input bg-background p-4">
      <h2 className="text-base font-medium">{t('myBookings')}</h2>
      {bookings.length ? (
        <ul className="flex flex-col gap-2">
          {bookings.map((booking) => (
            <BookingRow key={booking.id} booking={booking} onChanged={refresh} />
          ))}
        </ul>
      ) : (
        <p className="text-sm">{t('noBookings')}</p>
      )}
    </section>
  );
}
