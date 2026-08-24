'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@shearly/ui-design-system';

type StandingRow = {
  providerId: string;
  displayName: string | null;
  listed: boolean;
  cancellationCount: number;
  noShowCount: number;
  responseMissCount: number;
  totalBookings: number;
  completionRate: number | null;
  flagged: boolean;
};

function formatRate(rate: number | null): string {
  if (rate === null) {
    return '—';
  }
  return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 }).format(
    rate,
  );
}

/** OPS-004: per-provider standing metrics, threshold-flagged, with a suspend/relist action. */
export function StandingView() {
  const t = useTranslations('admin');
  const [providers, setProviders] = useState<StandingRow[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    const res = await fetch('/api/admin/standing', { credentials: 'include' });
    const body = (await res.json()) as { providers?: StandingRow[] };
    setProviders(body.providers ?? []);
    setLoaded(true);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function toggleListed(row: StandingRow) {
    setPendingId(row.providerId);
    const action = row.listed ? 'suspend' : 'relist';
    await fetch(`/api/admin/providers/${row.providerId}/${action}`, {
      method: 'POST',
      credentials: 'include',
    });
    setPendingId(null);
    await refresh();
  }

  if (!loaded) {
    return <p>{t('loading')}</p>;
  }
  if (!providers.length) {
    return <p>{t('noProviders')}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {providers.map((row) => (
        <li key={row.providerId} className="flex flex-col gap-2 rounded-md border border-input p-3">
          <span className="text-sm font-medium">
            {row.displayName ?? row.providerId}
            {row.flagged ? ` — ${t('flagged')}` : ''}
          </span>
          <span className="text-sm">
            {t('cancellations')}
            {': '}
            {row.cancellationCount}
          </span>
          <span className="text-sm">
            {t('noShows')}
            {': '}
            {row.noShowCount}
          </span>
          <span className="text-sm">
            {t('responseMisses')}
            {': '}
            {row.responseMissCount}
          </span>
          <span className="text-sm">
            {t('completionRate')}
            {': '}
            {formatRate(row.completionRate)}
          </span>
          <span className="text-sm">{row.listed ? t('listed') : t('suspended')}</span>
          <Button
            type="button"
            disabled={pendingId === row.providerId}
            onClick={() => void toggleListed(row)}
          >
            {row.listed ? t('suspend') : t('relist')}
          </Button>
        </li>
      ))}
    </ul>
  );
}
