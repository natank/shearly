'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, Input } from '@shearly/ui-design-system';

type BookingCard = {
  id: string;
  state: string;
  providerDisplayName: string;
  serviceName: string;
  slotStart: string;
  slotEnd: string;
  addressLine: string;
  totalMinor: number;
  currency: string;
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

/** BOK-008 (provider-no-show half): the server's own guard rejects
 * CustomerReportsProviderNoShow before slot_start has passed — this mirrors
 * that so the button only appears when the call would actually succeed. */
export function canReportProviderNoShow(
  booking: Pick<BookingCard, 'state' | 'slotStart'>,
  now: Date = new Date(),
): boolean {
  return booking.state === 'CONFIRMED' && new Date(booking.slotStart).getTime() < now.getTime();
}

function BookingRow({ booking, onReviewed }: { booking: BookingCard; onReviewed: () => void }) {
  const t = useTranslations('booking');
  const locale = useLocale();
  const [reviewing, setReviewing] = useState(false);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [done, setDone] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [noShowPending, setNoShowPending] = useState(false);
  const [noShowReported, setNoShowReported] = useState(false);

  async function submitReview() {
    setErrorKey(null);
    const res = await fetch(`/api/bookings/${booking.id}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ rating, body: body || undefined }),
    });
    if (!res.ok) {
      setErrorKey('reviewFailed');
      return;
    }
    setDone(true);
    setReviewing(false);
    onReviewed();
  }

  async function reportNoShow() {
    setErrorKey(null);
    setNoShowPending(true);
    const res = await fetch(`/api/bookings/${booking.id}/provider-no-show`, {
      method: 'PATCH',
      credentials: 'include',
    });
    setNoShowPending(false);
    if (!res.ok) {
      setErrorKey('noShowFailed');
      return;
    }
    setNoShowReported(true);
    onReviewed();
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-input p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span>{`${booking.providerDisplayName} — ${booking.serviceName}`}</span>
        <span>{booking.state}</span>
      </div>
      <span>{formatSlot(booking.slotStart, locale)}</span>
      <span>{`${booking.totalMinor / 100} ₪`}</span>
      <span>{booking.addressLine}</span>
      {canReportProviderNoShow(booking) && !noShowReported ? (
        <div className="flex flex-col gap-1">
          {errorKey === 'noShowFailed' ? <span>{t('noShowFailed')}</span> : null}
          <Button type="button" variant="outline" disabled={noShowPending} onClick={reportNoShow}>
            {t('reportNoShow')}
          </Button>
        </div>
      ) : null}
      {booking.state === 'COMPLETED' && !done ? (
        reviewing ? (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              {t('rating')}
              <select
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={rating}
                onChange={(event) => setRating(Number(event.target.value))}
              >
                {[5, 4, 3, 2, 1].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <Input
              placeholder={t('reviewBody')}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
            {errorKey ? <span>{t(errorKey as 'reviewFailed')}</span> : null}
            <Button type="button" onClick={submitReview}>
              {t('submitReview')}
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" onClick={() => setReviewing(true)}>
            {t('leaveReview')}
          </Button>
        )
      ) : null}
    </li>
  );
}

/** CUS-006: upcoming (soonest-first) and past (most-recent-first), each
 * booking shows provider, service, price, address, time, state. A
 * COMPLETED booking not yet reviewed gets an inline, dismissible prompt
 * (RAT-001) — not a popup that reappears every visit. */
export function BookingHistory() {
  const t = useTranslations('booking');
  const [upcoming, setUpcoming] = useState<BookingCard[]>([]);
  const [past, setPast] = useState<BookingCard[]>([]);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    const res = await fetch('/api/account/me/bookings', { credentials: 'include' });
    if (!res.ok) {
      setLoaded(true);
      return;
    }
    const body = (await res.json()) as { upcoming: BookingCard[]; past: BookingCard[] };
    setUpcoming(body.upcoming);
    setPast(body.past);
    setLoaded(true);
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (!loaded) {
    return null;
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-medium">{t('upcoming')}</h2>
        {upcoming.length ? (
          <ul className="flex flex-col gap-2">
            {upcoming.map((booking) => (
              <BookingRow key={booking.id} booking={booking} onReviewed={refresh} />
            ))}
          </ul>
        ) : (
          <p className="text-sm">{t('noUpcoming')}</p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-medium">{t('past')}</h2>
        {past.length ? (
          <ul className="flex flex-col gap-2">
            {past.map((booking) => (
              <BookingRow key={booking.id} booking={booking} onReviewed={refresh} />
            ))}
          </ul>
        ) : (
          <p className="text-sm">{t('noPast')}</p>
        )}
      </div>
    </section>
  );
}
