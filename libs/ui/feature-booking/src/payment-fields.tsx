'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import { useTranslations } from 'next-intl';

/**
 * PAY-001/NFR-SEC-001: card data is collected by Stripe's own hosted
 * `CardElement` iframe and never touches Shearly's client bundle, network
 * requests, or servers — `stripe.createPaymentMethod` returns an opaque
 * `pm_...` id that is the only card-related value `onConfirm` ever sends to
 * `POST /bookings`. The booking API already accepts and authorizes a
 * `paymentMethodId` string server-side (design §8.1) — this component's
 * only job is turning real card input into a real one, replacing what was
 * previously a hardcoded placeholder string.
 */
let stripePromise: Promise<Stripe | null> | null = null;

function getStripePromise(publishableKey: string): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
}

async function fetchPublishableKey(): Promise<string> {
  const res = await fetch('/api/payments/config', { credentials: 'include' });
  if (!res.ok) {
    return '';
  }
  const body = (await res.json()) as { publishableKey: string };
  return body.publishableKey;
}

function CardForm({
  onReady,
  onError,
  registerSubmit,
}: {
  onReady: (ready: boolean) => void;
  onError: (message: string | null) => void;
  registerSubmit: (submit: () => Promise<string | null>) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const t = useTranslations('booking');

  useEffect(() => {
    registerSubmit(async () => {
      if (!stripe || !elements) {
        onError(t('cardUnavailable'));
        return null;
      }
      const card = elements.getElement(CardElement);
      if (!card) {
        onError(t('cardUnavailable'));
        return null;
      }
      const result = await stripe.createPaymentMethod({ type: 'card', card });
      if (result.error) {
        onError(result.error.message ?? t('cardDeclined'));
        return null;
      }
      onError(null);
      return result.paymentMethod.id;
    });
    // registerSubmit/onError/t are stable across renders; stripe and elements
    // are the only inputs that should re-register the handler.
  }, [stripe, elements]);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-input p-3">
      <span className="text-sm">{t('cardDetails')}</span>
      <div className="rounded-md border border-input px-3 py-2">
        <CardElement
          onReady={() => onReady(true)}
          options={{ style: { base: { fontSize: '14px' } } }}
        />
      </div>
    </div>
  );
}

/**
 * Mounts Stripe Elements once the publishable key loads. `onSubmitRef`
 * receives the latest "create a real payment method from the entered card"
 * function — the parent confirm screen calls it at submit time and sends
 * the resulting `pm_...` id as `paymentMethodId`, same field the server
 * already expected.
 */
export function BookingPaymentFields({
  onReady,
  onError,
  submitRef,
}: {
  onReady: (ready: boolean) => void;
  onError: (message: string | null) => void;
  submitRef: { current: (() => Promise<string | null>) | null };
}) {
  const t = useTranslations('booking');
  const [publishableKey, setPublishableKey] = useState<string | null>(null);

  useEffect(() => {
    void fetchPublishableKey().then(setPublishableKey);
  }, []);

  useEffect(() => {
    // No STRIPE_PUBLISHABLE_KEY configured (local dev without real Stripe
    // keys, matching the server's existing stub-mode fallback): there is no
    // card element to wait on, so the confirm button is immediately usable
    // and onConfirm falls back to a stub payment method id.
    if (publishableKey === '') {
      submitRef.current = null;
      onReady(true);
    }
    // onReady/submitRef are stable across renders; only the resolved key
    // should decide the stub-mode fallback.
  }, [publishableKey]);

  const stripePromiseValue = useMemo(
    () => (publishableKey ? getStripePromise(publishableKey) : null),
    [publishableKey],
  );

  function registerSubmit(submit: () => Promise<string | null>) {
    submitRef.current = submit;
  }

  if (publishableKey === null) {
    return null;
  }

  if (!publishableKey || !stripePromiseValue) {
    return <p className="text-sm">{t('paymentUnavailable')}</p>;
  }

  return (
    <Elements stripe={stripePromiseValue}>
      <CardForm onReady={onReady} onError={onError} registerSubmit={registerSubmit} />
    </Elements>
  );
}
