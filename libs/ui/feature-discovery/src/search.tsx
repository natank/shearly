'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, Input } from '@shearly/ui-design-system';

type Card = {
  id: string;
  displayName: string;
  photoUrl: string | null;
  headlinePriceMinor: number | null;
  rating: number | null;
  reviewCount: number;
  newProvider: boolean;
  nextSlot: string | null;
  distanceKm: number;
};

type DiscoveryState =
  | { state: 'need_location' }
  | { state: 'out_of_area' }
  | { state: 'no_matches'; filters: Record<string, string | number | undefined> }
  | { state: 'ok'; providers: Card[] };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      {children}
    </label>
  );
}

function formatSlot(value: string | null, locale: string): string {
  if (!value) {
    return '';
  }
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function DiscoverySearch() {
  const t = useTranslations('discovery');
  const locale = useLocale();
  const [result, setResult] = useState<DiscoveryState>({ state: 'need_location' });

  async function load(search: string) {
    const res = await fetch(`/api/discovery${search}`);
    setResult((await res.json()) as DiscoveryState);
  }

  useEffect(() => {
    void load(window.location.search);
  }, []);

  async function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const key of ['q', 'service', 'minPrice', 'maxPrice', 'minRating', 'date']) {
      const value = String(form.get(key) ?? '').trim();
      if (value) {
        params.set(key, value);
      }
    }
    const search = params.toString() ? `?${params.toString()}` : '';
    window.history.replaceState(null, '', search || window.location.pathname);
    await load(search);
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-md border border-input bg-background p-4">
        <h1 className="text-xl font-medium">{t('title')}</h1>
        <p className="text-sm">{t('prompt')}</p>
        <form onSubmit={onSearch} className="flex flex-col gap-3">
          <Field label={t('location')}>
            <Input name="q" />
          </Field>
          <Field label={t('service')}>
            <Input name="service" />
          </Field>
          <Field label={t('minPrice')}>
            <Input name="minPrice" />
          </Field>
          <Field label={t('maxPrice')}>
            <Input name="maxPrice" />
          </Field>
          <Field label={t('minRating')}>
            <Input name="minRating" />
          </Field>
          <Field label={t('date')}>
            <Input name="date" type="date" />
          </Field>
          <Button type="submit">{t('search')}</Button>
        </form>
      </section>

      {result.state === 'need_location' ? <p className="text-sm">{t('needLocation')}</p> : null}
      {result.state === 'out_of_area' ? <p className="text-sm">{t('outOfArea')}</p> : null}
      {result.state === 'no_matches' ? (
        <p className="text-sm">
          {t('noMatches')}
          {': '}
          {t('activeFilters')}
          {': '}
          {Object.keys(result.filters)
            .filter((key) => result.filters[key])
            .join(', ')}
        </p>
      ) : null}
      {result.state === 'ok' ? (
        <ul className="flex flex-col gap-3">
          {result.providers.map((card) => (
            <li key={card.id} className="flex flex-col gap-2 rounded-md border border-input p-4">
              {card.photoUrl ? (
                <img src={card.photoUrl} alt="" className="h-32 w-full rounded-md object-cover" />
              ) : null}
              <p className="font-medium">{card.displayName}</p>
              <p className="text-sm">{t('vettingBadge')}</p>
              {card.headlinePriceMinor !== null ? (
                <p className="text-sm">
                  {card.headlinePriceMinor / 100}
                  {' ₪ · '}
                  {t('travelIncluded')}
                </p>
              ) : null}
              <p className="text-sm">
                {card.newProvider
                  ? t('newProvider')
                  : `${t('rating')}: ${card.rating ?? ''} (${card.reviewCount})`}
              </p>
              {card.nextSlot ? (
                <p className="text-sm">
                  {t('nextSlot')}
                  {': '}
                  {formatSlot(card.nextSlot, locale)}
                </p>
              ) : null}
              <a className="text-sm underline" href={`/${locale}/providers/${card.id}`}>
                {t('openProfile')}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
