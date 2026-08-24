'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

type FunnelData = {
  from: string;
  to: string;
  discoverySearches: number;
  profileViews: number;
  slotViews: number;
  bookingsCreated: number;
  bookingsConfirmed: number;
  bookingsCompleted: number;
  bookingsDeclined: number;
  bookingsExpired: number;
  paymentFailures: number;
};

type FunnelStage = {
  key: keyof Pick<
    FunnelData,
    | 'discoverySearches'
    | 'profileViews'
    | 'slotViews'
    | 'bookingsCreated'
    | 'bookingsConfirmed'
    | 'bookingsCompleted'
  >;
  labelKey:
    | 'discoverySearches'
    | 'profileViews'
    | 'slotViews'
    | 'bookingsCreated'
    | 'bookingsConfirmed'
    | 'bookingsCompleted';
};

const STAGES: FunnelStage[] = [
  { key: 'discoverySearches', labelKey: 'discoverySearches' },
  { key: 'profileViews', labelKey: 'profileViews' },
  { key: 'slotViews', labelKey: 'slotViews' },
  { key: 'bookingsCreated', labelKey: 'bookingsCreated' },
  { key: 'bookingsConfirmed', labelKey: 'bookingsConfirmed' },
  { key: 'bookingsCompleted', labelKey: 'bookingsCompleted' },
];

/** OPS-006: discovery -> profile view -> slot selected -> booking created -> confirmed -> completed, with per-stage drop-off and payment failures/expiries/declines shown separately. */
export function FunnelView() {
  const t = useTranslations('admin');
  const [data, setData] = useState<FunnelData | null>(null);

  useEffect(() => {
    async function refresh() {
      const res = await fetch('/api/admin/funnel', { credentials: 'include' });
      const body = (await res.json()) as FunnelData;
      setData(body);
    }
    void refresh();
  }, []);

  if (!data) {
    return <p>{t('loading')}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {STAGES.map((stage, index) => {
          const value = data[stage.key];
          const previous = index > 0 ? data[STAGES[index - 1].key] : null;
          const dropOff = previous !== null && previous > 0 ? 1 - value / previous : null;
          return (
            <li key={stage.key} className="flex flex-col gap-1 rounded-md border border-input p-3">
              <span className="text-sm font-medium">
                {t(stage.labelKey)}
                {': '}
                {value}
              </span>
              {dropOff !== null ? (
                <span className="text-sm">
                  {t('dropOff')}
                  {': '}
                  {new Intl.NumberFormat(undefined, {
                    style: 'percent',
                    maximumFractionDigits: 0,
                  }).format(dropOff)}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-1 rounded-md border border-input p-3">
        <span className="text-sm">
          {t('bookingsDeclined')}
          {': '}
          {data.bookingsDeclined}
        </span>
        <span className="text-sm">
          {t('bookingsExpired')}
          {': '}
          {data.bookingsExpired}
        </span>
        <span className="text-sm">
          {t('paymentFailures')}
          {': '}
          {data.paymentFailures}
        </span>
      </div>
    </div>
  );
}
