'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, Input } from '@shearly/ui-design-system';
import type { PublicAccount } from '@shearly/contracts-identity';
import { isCompleteDraft, type BookingSelection } from './draft';
import { BookingPaymentFields } from './payment-fields';

type SavedAddress = {
  id: string;
  label: string;
  line: string;
  lat: number;
  lng: number;
  access_notes: string;
};

type ConfirmResult =
  | {
      state: 'PENDING';
      id: string;
      slotStart: string;
      totalMinor: number;
      responseDeadline: string;
    }
  | { state: 'conflict'; alternatives: unknown };

type AddressChoice = { addressLine: string; accessNotes: string; lat?: number; lng?: number };

function formatSlot(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

/**
 * CUS-001 mid-flow auth: the visitor picks a slot on the profile page (no
 * account needed, M3), lands here to confirm, and is asked to authenticate
 * only if they try to submit while signed out — never before. The selection
 * is saved as a guest draft (signed cookie, design §6.7) before the
 * redirect, and restored here on return so the visitor lands back on this
 * same confirm screen with the same slot and address, not the discovery
 * start.
 *
 * Address entry reuses the CUS-005 address book (M3): a signed-in customer
 * picks a saved address (already geocoded) or saves a new one, which
 * geocodes it server-side — the confirm screen never calls a geocoder
 * itself.
 */
export function BookingConfirm({ selection }: { selection: BookingSelection }) {
  const t = useTranslations('booking');
  const locale = useLocale();
  const [account, setAccount] = useState<PublicAccount | null | undefined>(undefined);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [choice, setChoice] = useState<AddressChoice>({
    addressLine: selection.addressLine ?? '',
    accessNotes: selection.accessNotes ?? '',
    lat: selection.lat,
    lng: selection.lng,
  });
  const [newAddress, setNewAddress] = useState({ label: '', line: '', accessNotes: '' });
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const [cardErrorMessage, setCardErrorMessage] = useState<string | null>(null);
  const createPaymentMethodRef = useRef<(() => Promise<string | null>) | null>(null);

  useEffect(() => {
    void (async () => {
      const me = await fetch('/api/me', { credentials: 'include' });
      if (!me.ok) {
        setAccount(null);
        return;
      }
      const body = (await me.json()) as { account: PublicAccount };
      setAccount(body.account);

      const draftRes = await fetch('/api/auth/guest-draft', { credentials: 'include' });
      const draftBody = (await draftRes.json()) as { draft?: Partial<BookingSelection> };
      if (draftBody.draft?.addressLine) {
        setChoice({
          addressLine: draftBody.draft.addressLine,
          accessNotes: draftBody.draft.accessNotes ?? '',
          lat: draftBody.draft.lat,
          lng: draftBody.draft.lng,
        });
      }

      const addrRes = await fetch('/api/account/me/addresses', { credentials: 'include' });
      if (addrRes.ok) {
        const addrBody = (await addrRes.json()) as { addresses: SavedAddress[] };
        setAddresses(addrBody.addresses);
      }
    })();
  }, []);

  async function saveDraftAndAuthenticate(target: 'sign-in' | 'register') {
    await fetch('/api/auth/guest-draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ ...selection, ...choice }),
    });
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/${locale}/${target}?next=${next}`;
  }

  function selectSaved(address: SavedAddress) {
    setChoice({
      addressLine: address.line,
      accessNotes: address.access_notes,
      lat: address.lat,
      lng: address.lng,
    });
  }

  async function saveNewAddress() {
    setErrorKey(null);
    const res = await fetch('/api/account/me/addresses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(newAddress),
    });
    if (!res.ok) {
      setErrorKey('unknownAddress');
      return;
    }
    const address = (await res.json()) as { address: SavedAddress };
    setAddresses((prev) => [...prev, address.address]);
    selectSaved(address.address);
    setNewAddress({ label: '', line: '', accessNotes: '' });
  }

  async function onConfirm() {
    const draft = { ...selection, ...choice };
    if (!isCompleteDraft(draft)) {
      setErrorKey('missingAddress');
      return;
    }
    setPending(true);
    setErrorKey(null);
    setCardErrorMessage(null);
    // No real Stripe keys configured (dev without STRIPE_PUBLISHABLE_KEY):
    // createPaymentMethod stays null, matching the server's own stub-mode
    // fallback (AuthorizationService.isStubbed()) — send a placeholder the
    // server never actually validates against Stripe.
    const createPaymentMethod = createPaymentMethodRef.current;
    const paymentMethodId = createPaymentMethod ? await createPaymentMethod() : 'pm_stub';
    if (createPaymentMethod && !paymentMethodId) {
      setPending(false);
      return;
    }
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      credentials: 'include',
      body: JSON.stringify({ ...draft, paymentMethodId }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    setPending(false);
    if (res.status === 409) {
      setResult({ state: 'conflict', alternatives: body.alternatives });
      return;
    }
    if (!res.ok) {
      setErrorKey('confirmFailed');
      return;
    }
    setResult({
      state: 'PENDING',
      id: body.id as string,
      slotStart: body.slotStart as string,
      totalMinor: body.totalMinor as number,
      responseDeadline: body.responseDeadline as string,
    });
  }

  if (account === undefined) {
    return <p className="text-sm">{t('loading')}</p>;
  }

  if (result?.state === 'PENDING') {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-3 rounded-md border border-input bg-background p-4">
        <h1 className="text-xl font-medium">{t('confirmed')}</h1>
        <p className="text-sm">{`${t('state')}: ${result.state}`}</p>
        <p className="text-sm">{formatSlot(result.slotStart, locale)}</p>
        <p className="text-sm">{`${t('total')}: ${result.totalMinor / 100} ₪`}</p>
        <p className="text-sm">
          {`${t('responseDeadline')}: ${formatSlot(result.responseDeadline, locale)}`}
        </p>
      </div>
    );
  }

  if (result?.state === 'conflict') {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-3 rounded-md border border-input bg-background p-4">
        <h1 className="text-xl font-medium">{t('slotTaken')}</h1>
        <p className="text-sm">{t('slotTakenHint')}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 rounded-md border border-input bg-background p-4">
      <h1 className="text-xl font-medium">{t('confirmTitle')}</h1>
      <p className="text-sm">{formatSlot(selection.slotStart, locale)}</p>

      {account ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{t('address')}</h2>
          {addresses.map((address) => (
            <label key={address.id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="address"
                checked={choice.addressLine === address.line}
                onChange={() => selectSaved(address)}
              />
              {`${address.label} — ${address.line}`}
            </label>
          ))}
          {choice.addressLine &&
          !addresses.some((address) => address.line === choice.addressLine) ? (
            <p className="text-sm">{`${t('usingSelectedAddress')}: ${choice.addressLine}`}</p>
          ) : null}
          <div className="flex flex-col gap-2 rounded-md border border-input p-3">
            <span className="text-sm">{t('addNewAddress')}</span>
            <label className="flex flex-col gap-1 text-sm">
              {t('addressLabelField')}
              <Input
                value={newAddress.label}
                onChange={(event) =>
                  setNewAddress((prev) => ({ ...prev, label: event.target.value }))
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('addressLineField')}
              <Input
                value={newAddress.line}
                onChange={(event) =>
                  setNewAddress((prev) => ({ ...prev, line: event.target.value }))
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('accessNotes')}
              <Input
                value={newAddress.accessNotes}
                onChange={(event) =>
                  setNewAddress((prev) => ({ ...prev, accessNotes: event.target.value }))
                }
              />
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={saveNewAddress}
              disabled={!newAddress.label || !newAddress.line}
            >
              {t('saveAddress')}
            </Button>
          </div>
        </section>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          {t('address')}
          <Input
            value={choice.addressLine}
            onChange={(event) =>
              setChoice((prev) => ({ ...prev, addressLine: event.target.value }))
            }
            required
          />
        </label>
      )}

      {account ? (
        <BookingPaymentFields
          onReady={setCardReady}
          onError={setCardErrorMessage}
          submitRef={createPaymentMethodRef}
        />
      ) : null}

      {errorKey ? (
        <p role="alert" className="text-sm">
          {t(errorKey as 'missingAddress')}
        </p>
      ) : null}
      {cardErrorMessage ? (
        <p role="alert" className="text-sm">
          {cardErrorMessage}
        </p>
      ) : null}
      {account ? (
        <Button
          type="button"
          onClick={onConfirm}
          disabled={pending || !isCompleteDraft({ ...selection, ...choice }) || !cardReady}
        >
          {t('confirmAndPay')}
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{t('authRequired')}</p>
          <div className="flex gap-2">
            <Button type="button" onClick={() => saveDraftAndAuthenticate('sign-in')}>
              {t('signInToContinue')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => saveDraftAndAuthenticate('register')}
            >
              {t('registerToContinue')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
