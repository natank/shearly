'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@shearly/ui-design-system';

type Review = {
  id: string;
  rating: number;
  body: string | null;
  createdAt: string;
  reply: string | null;
  replyCreatedAt: string | null;
};

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function ReplyForm({ reviewId, onReplied }: { reviewId: string; onReplied: () => void }) {
  const t = useTranslations('provider');
  const [reply, setReply] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  async function submit() {
    if (!reply.trim()) {
      return;
    }
    setSubmitting(true);
    setError(false);
    const res = await fetch(`/api/catalog/me/reviews/${reviewId}/reply`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reply }),
    });
    setSubmitting(false);
    if (res.ok) {
      onReplied();
    } else {
      setError(true);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        {t('replyLabel')}
        <textarea
          className="rounded-md border border-input bg-background p-2 text-sm"
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          rows={3}
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm">
          {t('replyError')}
        </p>
      ) : null}
      <Button
        type="button"
        onClick={() => void submit()}
        disabled={submitting || !reply.trim()}
        className="self-start"
      >
        {t('replySubmit')}
      </Button>
    </div>
  );
}

/** RAT-003: a provider's own reviews, with a one-time public reply per
 * review — reviews stay one-directional otherwise (RAT-002), this is not a
 * threaded conversation, so a review that already has a reply shows it
 * read-only instead of the reply form. */
export function ProviderReviews() {
  const t = useTranslations('provider');
  const locale = useLocale();
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const res = await fetch('/api/catalog/me/reviews', { credentials: 'include' });
    if (res.ok) {
      const body = (await res.json()) as { reviews: Review[] };
      setReviews(body.reviews);
    }
    setLoaded(true);
  }

  useEffect(() => {
    void load();
  }, []);

  if (!loaded) {
    return <p className="text-sm">{t('loading')}</p>;
  }

  return (
    <section className="flex flex-col gap-4 rounded-md border border-input bg-background p-4">
      <h2 className="text-base font-medium">{t('reviews')}</h2>
      {reviews && reviews.length ? (
        <ul className="flex flex-col gap-3">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="flex flex-col gap-2 rounded-md border border-input p-3 text-sm"
            >
              <span>
                {review.rating}
                {'/5'}
                {' · '}
                {formatDate(review.createdAt, locale)}
              </span>
              {review.body ? <p>{review.body}</p> : null}
              {review.reply ? (
                <div className="rounded-md border border-input p-2">
                  <p className="text-xs font-medium">{t('yourReply')}</p>
                  <p>{review.reply}</p>
                </div>
              ) : (
                <ReplyForm reviewId={review.id} onReplied={() => void load()} />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">{t('noReviews')}</p>
      )}
    </section>
  );
}
