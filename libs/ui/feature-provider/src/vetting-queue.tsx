'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input } from '@shearly/ui-design-system';

type QueueItem = {
  id: string;
  account_id: string;
  status: string;
  display_name: string | null;
  email: string | null;
};

type DocumentMeta = { id: string; kind: string; original_name: string };

type Detail = {
  provider: QueueItem;
  documents: DocumentMeta[];
  missing: string[];
};

function QueueCard({ item, onChanged }: { item: QueueItem; onChanged: () => void }) {
  const t = useTranslations('vetting');
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [rationale, setRationale] = useState('');
  const [pending, setPending] = useState(false);

  async function loadDetail() {
    const res = await fetch(`/api/admin/vetting/${item.id}`, { credentials: 'include' });
    if (res.ok) {
      setDetail((await res.json()) as Detail);
    }
  }

  async function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && !detail) {
      await loadDetail();
    }
  }

  async function decide(action: 'interview' | 'approve' | 'reject') {
    setPending(true);
    await fetch(`/api/admin/vetting/${item.id}/decision`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, rationale: rationale || action }),
    });
    setPending(false);
    setRationale('');
    onChanged();
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-input p-3">
      <button
        type="button"
        className="flex flex-col items-start gap-1 text-start"
        onClick={() => void toggle()}
      >
        <span className="text-sm font-medium">{item.display_name || t('unnamed')}</span>
        <span className="text-sm">{item.email || item.account_id}</span>
        <span className="text-sm">
          {item.status === 'interview_scheduled' ? t('statusInterview') : t('statusPending')}
        </span>
      </button>

      {expanded ? (
        <div className="flex flex-col gap-2 rounded-md border border-input p-3">
          {detail ? (
            <>
              {detail.missing.length ? (
                <p className="text-sm">
                  {t('missing')}
                  {': '}
                  {detail.missing.join(', ')}
                </p>
              ) : null}
              {detail.documents.length ? (
                <ul className="flex flex-col gap-1">
                  {detail.documents.map((doc) => (
                    <li key={doc.id} className="text-sm">
                      <a
                        href={`/api/admin/vetting/${item.id}/documents/${doc.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {`${doc.kind} — ${t('openDoc')}`}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
          <Input
            placeholder={t('rationalePlaceholder')}
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
          />
        </div>
      ) : null}

      {item.status === 'pending_review' ? (
        <Button type="button" disabled={pending} onClick={() => void decide('interview')}>
          {t('interview')}
        </Button>
      ) : null}
      {item.status === 'interview_scheduled' ? (
        <Button type="button" disabled={pending} onClick={() => void decide('approve')}>
          {t('approve')}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => void decide('reject')}
      >
        {t('reject')}
      </Button>
    </li>
  );
}

/** QCF-003: the queue card previously showed only a status string, making
 * two pending providers indistinguishable — now shows name/email, and an
 * expandable detail with the submitted documents (open link) and any
 * missing items, plus a real rationale field feeding the decision instead
 * of the action name being reused as a fake reason. */
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

  if (!queue.length) {
    return <p>{t('empty')}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {queue.map((item) => (
        <QueueCard key={item.id} item={item} onChanged={refresh} />
      ))}
    </ul>
  );
}
