'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@shearly/ui-design-system';

type Exception = {
  key: string;
  kind: string;
  bookingId: string;
  result: { message?: string; amountMinor?: number; currency?: string; reason?: string };
  updatedAt: string;
};

function formatMinor(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(
    amountMinor / 100,
  );
}

/** OPS-002: failed capture/refund operations with a retry action per row. */
export function ExceptionsView() {
  const t = useTranslations('admin');
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch('/api/admin/exceptions', { credentials: 'include' });
    const body = (await res.json()) as { exceptions?: Exception[] };
    setExceptions(body.exceptions ?? []);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function retry(key: string) {
    setPendingKey(key);
    await fetch(`/api/admin/exceptions/${encodeURIComponent(key)}/retry`, {
      method: 'POST',
      credentials: 'include',
    });
    setPendingKey(null);
    await refresh();
  }

  if (!exceptions.length) {
    return <p>{t('noExceptions')}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {exceptions.map((exception) => (
        <li key={exception.key} className="flex flex-col gap-2 rounded-md border border-input p-3">
          <span className="text-sm font-medium">
            {exception.kind}
            {' — '}
            {exception.bookingId}
          </span>
          {exception.result.amountMinor !== undefined && exception.result.currency ? (
            <span className="text-sm">
              {formatMinor(exception.result.amountMinor, exception.result.currency)}
            </span>
          ) : null}
          {exception.result.message ? (
            <span className="text-sm">{exception.result.message}</span>
          ) : null}
          <Button
            type="button"
            disabled={pendingKey === exception.key}
            onClick={() => void retry(exception.key)}
          >
            {t('retry')}
          </Button>
        </li>
      ))}
    </ul>
  );
}
