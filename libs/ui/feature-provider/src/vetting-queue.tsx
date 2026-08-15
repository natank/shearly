'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@shearly/ui-design-system';

type QueueItem = { id: string; account_id: string; status: string };

export function VettingQueue() {
  const t = useTranslations('vetting');
  const [queue, setQueue] = useState<QueueItem[]>([]);

  async function refresh() {
    const res = await fetch('/api/admin/vetting', { credentials: 'include' });
    const body = (await res.json()) as { queue?: QueueItem[] };
    setQueue(body.queue ?? []);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function decide(id: string, action: 'interview' | 'approve' | 'reject') {
    await fetch(`/api/admin/vetting/${id}/decision`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, rationale: action }),
    });
    await refresh();
  }

  if (!queue.length) {
    return <p>{t('empty')}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {queue.map((item) => (
        <li key={item.id} className="flex flex-col gap-2">
          <p>{item.id}</p>
          <Button type="button" onClick={() => void decide(item.id, 'interview')}>
            {t('interview')}
          </Button>
          <Button type="button" onClick={() => void decide(item.id, 'approve')}>
            {t('approve')}
          </Button>
          <Button type="button" onClick={() => void decide(item.id, 'reject')}>
            {t('reject')}
          </Button>
        </li>
      ))}
    </ul>
  );
}
