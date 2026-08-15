'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input } from '@shearly/ui-design-system';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  return (await res.json()) as T;
}

type Profile = {
  bio: string;
  baseLat: number | null;
  baseLng: number | null;
  radiusKm: number | null;
};
type Service = { id: string; name: string; duration_minutes: number; price_minor: number };
type Weekly = { weekday: number; startMinute: number; endMinute: number };

export function ProviderDashboard() {
  const t = useTranslations('provider');
  const [status, setStatus] = useState('');
  const [missing, setMissing] = useState<string[]>([]);
  const [profile, setProfile] = useState<Profile>({
    bio: '',
    baseLat: null,
    baseLng: null,
    radiusKm: null,
  });
  const [services, setServices] = useState<Service[]>([]);
  const [weekly, setWeekly] = useState<Weekly[]>([]);
  const [goLive, setGoLive] = useState<{
    ready: boolean;
    missing: string[];
    listed: boolean;
  } | null>(null);
  const [net, setNet] = useState<number | null>(null);

  async function refresh() {
    const app = await json<{
      status: string;
      missing: string[];
      profile?: Profile;
    }>('/api/catalog/me/application');
    setStatus(app.status);
    setMissing(app.missing);
    if (app.profile) {
      setProfile(app.profile);
    }
    const listed = await json<{ services: Service[] }>('/api/catalog/me/services');
    setServices(listed.services);
    const schedule = await json<{ weekly: Weekly[] }>('/api/availability/me/schedule');
    setWeekly(schedule.weekly);
    setGoLive(await json('/api/catalog/me/go-live'));
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onSubmitApp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const files = form.elements.namedItem('files') as HTMLInputElement;
    const kind = (form.elements.namedItem('kind') as HTMLInputElement).value;
    const chosen = files.files;
    if (!chosen) {
      return;
    }
    for (const file of Array.from(chosen)) {
      const body = new FormData();
      body.set('kind', kind);
      body.set('file', file);
      await fetch('/api/catalog/me/documents', { method: 'POST', credentials: 'include', body });
    }
    await fetch('/api/catalog/me/submit', { method: 'POST', credentials: 'include' });
    await refresh();
  }

  async function onProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await json('/api/catalog/me/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bio: String(form.get('bio') ?? ''),
        baseLat: Number(form.get('lat')),
        baseLng: Number(form.get('lng')),
        radiusKm: Number(form.get('radius')),
      }),
    });
    await refresh();
  }

  async function onService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await json<{ quote: { net: number } }>('/api/catalog/me/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: String(form.get('name') ?? ''),
        description: '',
        durationMinutes: Number(form.get('duration')),
        priceMinor: Number(form.get('price')),
      }),
    });
    setNet(result.quote.net);
    await refresh();
  }

  async function onWeekly(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await json('/api/availability/me/weekly', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rules: [
          {
            weekday: Number(form.get('weekday')),
            startMinute: Number(form.get('start')),
            endMinute: Number(form.get('end')),
          },
        ],
      }),
    });
    await refresh();
  }

  async function onBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await json('/api/availability/me/exceptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: String(form.get('date') ?? ''), kind: 'block' }),
    });
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2>{t('application')}</h2>
        <p>
          {t('status')}
          {': '}
          {status}
        </p>
        {missing.length ? (
          <p>
            {t('missing')}
            {': '}
            {missing.join(', ')}
          </p>
        ) : null}
        <form onSubmit={onSubmitApp} className="flex flex-col gap-2">
          <select name="kind" className="h-10 rounded-md border border-input bg-background px-3">
            <option value="government_id">{'government_id'}</option>
            <option value="credential">{'credential'}</option>
            <option value="portfolio">{'portfolio'}</option>
          </select>
          <Input name="files" type="file" multiple />
          <Button type="submit">{t('submit')}</Button>
        </form>
      </section>
      <section className="flex flex-col gap-2">
        <h2>{t('profile')}</h2>
        <form onSubmit={onProfile} className="flex flex-col gap-2">
          <Input
            name="bio"
            placeholder={t('bio')}
            value={profile.bio}
            onChange={(event) => setProfile({ ...profile, bio: event.target.value })}
          />
          <Input
            name="lat"
            placeholder={t('latitude')}
            value={profile.baseLat ?? ''}
            onChange={(event) =>
              setProfile({
                ...profile,
                baseLat: event.target.value === '' ? null : Number(event.target.value),
              })
            }
          />
          <Input
            name="lng"
            placeholder={t('longitude')}
            value={profile.baseLng ?? ''}
            onChange={(event) =>
              setProfile({
                ...profile,
                baseLng: event.target.value === '' ? null : Number(event.target.value),
              })
            }
          />
          <Input
            name="radius"
            placeholder={t('radius')}
            value={profile.radiusKm ?? ''}
            onChange={(event) =>
              setProfile({
                ...profile,
                radiusKm: event.target.value === '' ? null : Number(event.target.value),
              })
            }
          />
          <Button type="submit">{t('saveProfile')}</Button>
        </form>
      </section>
      <section className="flex flex-col gap-2">
        <h2>{t('services')}</h2>
        {services.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {services.map((service) => (
              <li key={service.id}>
                {service.name}
                {' · '}
                {service.duration_minutes}
                {' · '}
                {service.price_minor / 100}
              </li>
            ))}
          </ul>
        ) : null}
        {net !== null ? (
          <p>
            {t('net')}
            {': '}
            {net}
          </p>
        ) : null}
        <form onSubmit={onService} className="flex flex-col gap-2">
          <Input name="name" placeholder={t('serviceName')} />
          <Input name="duration" placeholder={t('duration')} defaultValue="60" />
          <Input name="price" placeholder={t('price')} defaultValue="20000" />
          <Button type="submit">{t('addService')}</Button>
        </form>
      </section>
      <section className="flex flex-col gap-2">
        <h2>{t('availability')}</h2>
        {weekly.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {weekly.map((rule) => (
              <li key={`${rule.weekday}-${rule.startMinute}`}>
                {rule.weekday}
                {' · '}
                {rule.startMinute}
                {'–'}
                {rule.endMinute}
              </li>
            ))}
          </ul>
        ) : null}
        <form onSubmit={onWeekly} className="flex flex-col gap-2">
          <Input name="weekday" placeholder={t('weekday')} defaultValue="1" />
          <Input name="start" placeholder={t('startMinute')} defaultValue="540" />
          <Input name="end" placeholder={t('endMinute')} defaultValue="1020" />
          <Button type="submit">{t('saveWeekly')}</Button>
        </form>
        <form onSubmit={onBlock} className="flex flex-col gap-2">
          <Input name="date" placeholder={t('blockDate')} />
          <Button type="submit">{t('block')}</Button>
        </form>
      </section>
      <section className="flex flex-col gap-2">
        <h2>{t('goLive')}</h2>
        <p>{goLive?.ready ? t('ready') : t('notReady')}</p>
        {goLive?.missing?.length ? (
          <p>
            {t('missing')}
            {': '}
            {goLive.missing.join(', ')}
          </p>
        ) : null}
        <Button
          type="button"
          onClick={async () => {
            await json('/api/payments/me/connect/stub-complete', { method: 'POST' });
            await refresh();
          }}
        >
          {t('connectStub')}
        </Button>
        <Button
          type="button"
          onClick={async () => {
            await json('/api/catalog/me/go-live', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ listed: !goLive?.listed }),
            });
            await refresh();
          }}
        >
          {goLive?.listed ? t('unlistMe') : t('listMe')}
        </Button>
      </section>
    </div>
  );
}
