'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

type EarningsRow = {
  bookingId: string;
  slotStart: string;
  currency: string;
  grossMinor: number;
  commissionMinor: number;
  netMinor: number;
};

type Earnings = {
  commissionRate: number;
  pendingMinor: number;
  paidOutMinor: number;
  bookings: EarningsRow[];
};

function formatMinor(minor: number): string {
  return `${(minor / 100).toLocaleString()} ₪`;
}

function formatSlot(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

/** PAY-004: read-only earnings — per-booking gross/commission/net from the
 * ledger, and pending-vs-paid-out balance. No payout trigger here (M5). */
export function ProviderEarnings() {
  const t = useTranslations('provider');
  const locale = useLocale();
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      const res = await fetch('/api/provider/me/earnings', { credentials: 'include' });
      if (res.ok) {
        setEarnings((await res.json()) as Earnings);
      }
      setLoaded(true);
    }
    void load();
  }, []);

  if (!loaded) {
    return null;
  }

  return (
    <section className="flex flex-col gap-4 rounded-md border border-input bg-background p-4">
      <h2 className="text-base font-medium">{t('earnings')}</h2>
      {earnings ? (
        <>
          <p className="text-sm">{`${t('commissionRateLabel')}: ${Math.round(earnings.commissionRate * 100)}%`}</p>
          <div className="flex flex-col gap-1 text-sm">
            <span>
              {t('pendingBalance')}
              {': '}
              {formatMinor(earnings.pendingMinor)}
            </span>
            <span>
              {t('paidOutBalance')}
              {': '}
              {formatMinor(earnings.paidOutMinor)}
            </span>
          </div>
          {earnings.bookings.length ? (
            <ul className="flex flex-col gap-2">
              {earnings.bookings.map((row) => (
                <li
                  key={row.bookingId}
                  className="flex flex-col gap-1 rounded-md border border-input p-3 text-sm"
                >
                  <span>{formatSlot(row.slotStart, locale)}</span>
                  <span>
                    {t('gross')}
                    {': '}
                    {formatMinor(row.grossMinor)}
                  </span>
                  <span>
                    {t('commission')}
                    {': '}
                    {formatMinor(row.commissionMinor)}
                  </span>
                  <span>
                    {t('netEarnings')}
                    {': '}
                    {formatMinor(row.netMinor)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">{t('noEarnings')}</p>
          )}
        </>
      ) : (
        <p className="text-sm">{t('noEarnings')}</p>
      )}
    </section>
  );
}
