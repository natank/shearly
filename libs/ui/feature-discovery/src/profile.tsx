'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

type Profile = {
  provider: { displayName: string; bio: string };
  vetting: { governmentId: boolean; credential: boolean; portfolio: boolean; interview: boolean };
  services: {
    id: string;
    name: string;
    durationMinutes: number;
    priceMinor: number;
    travelIncluded: boolean;
  }[];
  rating: { average: number | null; count: number; newProvider: boolean };
  reviews: { id: string; rating: number; body: string | null; createdAt: string }[];
  portfolio: { id: string; url: string }[];
  nextSlots: { start: string; end: string }[];
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

export function DiscoveryProfile({ providerId }: { providerId: string }) {
  const t = useTranslations('discovery');
  const locale = useLocale();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/catalog/public/${providerId}`);
      if (!res.ok) {
        setMissing(true);
        return;
      }
      setProfile((await res.json()) as Profile);
    })();
  }, [providerId]);

  if (missing) {
    return <p className="text-sm">{t('outOfArea')}</p>;
  }
  if (!profile) {
    return null;
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-md border border-input bg-background p-4">
        <h1 className="text-xl font-medium">{profile.provider.displayName}</h1>
        <p className="text-sm">{t('vettingBadge')}</p>
        <p className="text-sm">{profile.provider.bio}</p>
        {profile.portfolio[0] ? (
          <img
            src={profile.portfolio[0].url}
            alt=""
            className="h-48 w-full rounded-md object-cover"
          />
        ) : null}
        <p className="text-sm">
          {profile.rating.newProvider
            ? t('newProvider')
            : `${t('rating')}: ${profile.rating.average ?? ''} (${profile.rating.count})`}
        </p>
      </section>
      <section className="flex flex-col gap-3 rounded-md border border-input bg-background p-4">
        <h2 className="text-base font-medium">{t('menu')}</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {profile.services.map((service) => (
            <li key={service.id}>
              {service.name}
              {' · '}
              {service.durationMinutes} {t('minutes')}
              {' · '}
              {service.priceMinor / 100}
              {' ₪ · '}
              {t('travelIncluded')}
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-3 rounded-md border border-input bg-background p-4">
        <h2 className="text-base font-medium">{t('slots')}</h2>
        {profile.nextSlots.length && profile.services[0] ? (
          <ul className="flex flex-col gap-1 text-sm">
            {profile.nextSlots.map((slot) => (
              <li key={slot.start}>
                <a
                  className="underline"
                  href={`/${locale}/book/${providerId}/${profile.services[0].id}?slotStart=${encodeURIComponent(slot.start)}`}
                >
                  {formatSlot(slot.start, locale)}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">{t('noSlots')}</p>
        )}
      </section>
      <section className="flex flex-col gap-3 rounded-md border border-input bg-background p-4">
        <h2 className="text-base font-medium">{t('reviews')}</h2>
        {profile.reviews.length ? (
          <ul className="flex flex-col gap-2 text-sm">
            {profile.reviews.map((review) => (
              <li key={review.id}>
                {review.rating}
                {'/5'}
                {review.body ? ` · ${review.body}` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">{t('noReviews')}</p>
        )}
      </section>
    </div>
  );
}
