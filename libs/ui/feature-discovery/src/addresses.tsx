'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input } from '@shearly/ui-design-system';

type Address = { id: string; label: string; line: string; access_notes: string };

export function AddressBook() {
  const t = useTranslations('account');
  const [addresses, setAddresses] = useState<Address[]>([]);

  async function refresh() {
    const res = await fetch('/api/account/me/addresses', { credentials: 'include' });
    if (!res.ok) {
      return;
    }
    const body = (await res.json()) as { addresses: Address[] };
    setAddresses(body.addresses);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await fetch('/api/account/me/addresses', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: String(form.get('label') ?? ''),
        line: String(form.get('line') ?? ''),
        accessNotes: String(form.get('notes') ?? ''),
      }),
    });
    event.currentTarget.reset();
    await refresh();
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-input bg-background p-4">
      <h2 className="text-base font-medium">{t('addresses')}</h2>
      {addresses.length ? (
        <ul className="flex flex-col gap-2 text-sm">
          {addresses.map((address) => (
            <li key={address.id} className="flex items-center justify-between gap-2">
              <span>
                {address.label}
                {' · '}
                {address.line}
              </span>
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  await fetch(`/api/account/me/addresses/${address.id}`, {
                    method: 'DELETE',
                    credentials: 'include',
                  });
                  await refresh();
                }}
              >
                {t('deleteAddress')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={onSave} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('addressLabel')}</span>
          <Input name="label" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('addressLine')}</span>
          <Input name="line" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('accessNotes')}</span>
          <Input name="notes" />
        </label>
        <Button type="submit">{t('saveAddress')}</Button>
      </form>
    </section>
  );
}
