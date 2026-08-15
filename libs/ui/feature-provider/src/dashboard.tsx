'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input } from '@shearly/ui-design-system';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  return (await res.json()) as T;
}

function minutesFromTime(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function timeFromMinutes(total: number): string {
  const hours = String(Math.floor(total / 60)).padStart(2, '0');
  const minutes = String(total % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-input bg-background p-4">
      <h2 className="text-base font-medium">{title}</h2>
      {children}
    </section>
  );
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
    const kind = (form.elements.namedItem('kind') as HTMLSelectElement).value;
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
    await json('/api/catalog/me/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bio: profile.bio,
        baseLat: profile.baseLat,
        baseLng: profile.baseLng,
        radiusKm: profile.radiusKm,
      }),
    });
    await refresh();
  }

  async function onService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const shekels = Number(form.get('price'));
    const result = await json<{ quote: { net: number } }>('/api/catalog/me/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: String(form.get('name') ?? ''),
        description: '',
        durationMinutes: Number(form.get('duration')),
        priceMinor: Math.round(shekels * 100),
      }),
    });
    setNet(result.quote.net / 100);
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
            startMinute: minutesFromTime(String(form.get('start') ?? '09:00')),
            endMinute: minutesFromTime(String(form.get('end') ?? '17:00')),
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

  const selectClass = 'flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm';
  const dayKey = ['day0', 'day1', 'day2', 'day3', 'day4', 'day5', 'day6'] as const;

  return (
    <div className="flex w-full max-w-xl flex-col gap-6">
      <Section title={t('application')}>
        <p className="text-sm">
          {t('status')}
          {': '}
          {status}
        </p>
        {missing.length ? (
          <p className="text-sm">
            {t('missing')}
            {': '}
            {missing.join(', ')}
          </p>
        ) : null}
        <form onSubmit={onSubmitApp} className="flex flex-col gap-3">
          <Field label={t('docKind')}>
            <select name="kind" className={selectClass}>
              <option value="government_id">{t('kindId')}</option>
              <option value="credential">{t('kindCredential')}</option>
              <option value="portfolio">{t('kindPortfolio')}</option>
            </select>
          </Field>
          <Field label={t('files')}>
            <Input name="files" type="file" multiple />
          </Field>
          <Button type="submit">{t('submit')}</Button>
        </form>
      </Section>

      <Section title={t('profile')}>
        <form onSubmit={onProfile} className="flex flex-col gap-3">
          <Field label={t('bio')}>
            <Input
              name="bio"
              value={profile.bio}
              onChange={(event) => setProfile({ ...profile, bio: event.target.value })}
            />
          </Field>
          <Field label={t('latitude')}>
            <Input
              name="lat"
              value={profile.baseLat ?? ''}
              onChange={(event) =>
                setProfile({
                  ...profile,
                  baseLat: event.target.value === '' ? null : Number(event.target.value),
                })
              }
            />
          </Field>
          <Field label={t('longitude')}>
            <Input
              name="lng"
              value={profile.baseLng ?? ''}
              onChange={(event) =>
                setProfile({
                  ...profile,
                  baseLng: event.target.value === '' ? null : Number(event.target.value),
                })
              }
            />
          </Field>
          <Field label={t('radius')}>
            <Input
              name="radius"
              value={profile.radiusKm ?? ''}
              onChange={(event) =>
                setProfile({
                  ...profile,
                  radiusKm: event.target.value === '' ? null : Number(event.target.value),
                })
              }
            />
          </Field>
          <Button type="submit">{t('saveProfile')}</Button>
        </form>
      </Section>

      <Section title={t('services')}>
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
          <p className="text-sm">
            {t('net')}
            {': '}
            {net}
          </p>
        ) : null}
        <form onSubmit={onService} className="flex flex-col gap-3">
          <Field label={t('serviceName')}>
            <Input name="name" />
          </Field>
          <Field label={t('duration')}>
            <Input name="duration" defaultValue="60" />
          </Field>
          <Field label={t('price')}>
            <Input name="price" defaultValue="200" />
          </Field>
          <Button type="submit">{t('addService')}</Button>
        </form>
      </Section>

      <Section title={t('availability')}>
        {weekly.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {weekly.map((rule) => (
              <li key={`${rule.weekday}-${rule.startMinute}`}>
                {t(dayKey[rule.weekday] ?? 'day0')}
                {' · '}
                {timeFromMinutes(rule.startMinute)}
                {'–'}
                {timeFromMinutes(rule.endMinute)}
              </li>
            ))}
          </ul>
        ) : null}
        <form onSubmit={onWeekly} className="flex flex-col gap-3">
          <Field label={t('weekday')}>
            <select name="weekday" className={selectClass} defaultValue="1">
              <option value="0">{t('day0')}</option>
              <option value="1">{t('day1')}</option>
              <option value="2">{t('day2')}</option>
              <option value="3">{t('day3')}</option>
              <option value="4">{t('day4')}</option>
              <option value="5">{t('day5')}</option>
              <option value="6">{t('day6')}</option>
            </select>
          </Field>
          <Field label={t('startTime')}>
            <Input name="start" type="time" defaultValue="09:00" />
          </Field>
          <Field label={t('endTime')}>
            <Input name="end" type="time" defaultValue="17:00" />
          </Field>
          <Button type="submit">{t('saveWeekly')}</Button>
        </form>
        <form onSubmit={onBlock} className="flex flex-col gap-3">
          <Field label={t('blockDate')}>
            <Input name="date" type="date" />
          </Field>
          <Button type="submit" variant="outline">
            {t('block')}
          </Button>
        </form>
      </Section>

      <Section title={t('goLive')}>
        <p className="text-sm">{goLive?.ready ? t('ready') : t('notReady')}</p>
        {goLive?.missing?.map((item) => (
          <p key={item} className="text-sm">
            {item === 'vetting'
              ? t('missingVetting')
              : item === 'connect'
                ? t('missingConnect')
                : item === 'services'
                  ? t('missingServices')
                  : item === 'availability'
                    ? t('missingAvailability')
                    : item}
          </p>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            await json('/api/payments/me/connect/stub-complete', { method: 'POST' });
            await refresh();
          }}
        >
          {t('connectStub')}
        </Button>
        <Button
          type="button"
          disabled={!goLive?.listed && !goLive?.ready}
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
      </Section>
    </div>
  );
}
