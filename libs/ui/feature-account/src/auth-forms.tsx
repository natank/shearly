'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, Input } from '@shearly/ui-design-system';
import type { PublicAccount, RegisterRole } from '@shearly/contracts-identity';
import { homePathForRole } from './paths';

/** CUS-001 mid-flow auth: honors ?next=<path> so a guest returning from a
 * booking-draft redirect lands back on that page, not the role home. Only
 * an app-relative path is accepted — never an absolute URL — so this can't
 * be used as an open redirect. */
function nextPath(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

async function readJson(res: Response) {
  return (await res.json()) as { ok?: boolean; translationKey?: string; account?: PublicAccount };
}

export function RegisterForm() {
  const t = useTranslations('account');
  const locale = useLocale();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrorKey(null);
    const form = new FormData(event.currentTarget);
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
        role: String(form.get('role') ?? 'customer') as RegisterRole,
        locale,
      }),
    });
    const body = await readJson(res);
    const me = await fetch('/api/me', { credentials: 'include' });
    if (me.ok) {
      const session = (await me.json()) as { account: PublicAccount };
      window.location.href = nextPath() ?? `/${locale}${homePathForRole(session.account.role)}`;
      return;
    }
    setErrorKey(body.translationKey ?? 'auth.registerAccepted');
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        {t('email')}
        <Input name="email" type="email" required autoComplete="email" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t('password')}
        <Input
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
        />
        <span>{t('passwordHint')}</span>
      </label>
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend>{t('role')}</legend>
        <label>
          <input type="radio" name="role" value="customer" defaultChecked /> {t('roleCustomer')}
        </label>
        <label>
          <input type="radio" name="role" value="provider" /> {t('roleProvider')}
        </label>
      </fieldset>
      {errorKey ? <p role="alert">{t('registerAccepted')}</p> : null}
      <Button type="submit" disabled={pending}>
        {t('submitRegister')}
      </Button>
    </form>
  );
}

export function SignInForm({ adminOnly = false }: { adminOnly?: boolean }) {
  const t = useTranslations('account');
  const locale = useLocale();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrorKey(null);
    const form = new FormData(event.currentTarget);
    const res = await fetch('/api/auth/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
      }),
    });
    const body = await readJson(res);
    if (!body.ok) {
      setErrorKey('invalidCredentials');
      setPending(false);
      return;
    }
    const me = await fetch('/api/me', { credentials: 'include' });
    const session = (await me.json()) as { account?: PublicAccount };
    if (adminOnly && session.account?.role !== 'admin') {
      await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
      setErrorKey('adminOnly');
      setPending(false);
      return;
    }
    if (session.account && !adminOnly) {
      window.location.href = nextPath() ?? `/${locale}${homePathForRole(session.account.role)}`;
      return;
    }
    window.location.href = `/${locale}`;
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        {t('email')}
        <Input name="email" type="email" required autoComplete="email" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t('password')}
        <Input name="password" type="password" required autoComplete="current-password" />
      </label>
      {errorKey ? <p role="alert">{t(errorKey as 'invalidCredentials')}</p> : null}
      <Button type="submit" disabled={pending}>
        {t('submitSignIn')}
      </Button>
    </form>
  );
}

export function ResetRequestForm() {
  const t = useTranslations('account');
  const locale = useLocale();
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await fetch('/api/auth/password-reset/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: String(form.get('email') ?? ''), locale }),
    });
    setDone(true);
  }

  if (done) {
    return <p>{t('resetRequested')}</p>;
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        {t('email')}
        <Input name="email" type="email" required autoComplete="email" />
      </label>
      <Button type="submit">{t('requestReset')}</Button>
    </form>
  );
}

export function ResetConfirmForm({ token }: { token: string }) {
  const t = useTranslations('account');
  const locale = useLocale();
  const [error, setError] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const res = await fetch('/api/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token, password: String(form.get('password') ?? '') }),
    });
    if (!res.ok) {
      setError(true);
      return;
    }
    window.location.href = `/${locale}/sign-in`;
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        {t('newPassword')}
        <Input
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
        />
      </label>
      {error ? <p>{t('invalidCredentials')}</p> : null}
      <Button type="submit">{t('confirmReset')}</Button>
    </form>
  );
}

export function SignOutButton() {
  const t = useTranslations('account');
  const locale = useLocale();

  async function onClick() {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    window.location.href = `/${locale}`;
  }

  return (
    <Button type="button" variant="outline" onClick={onClick}>
      {t('signOut')}
    </Button>
  );
}
