import { createHmac, timingSafeEqual } from 'node:crypto';
import type { GuestDraft } from '@shearly/contracts-identity';

type Envelope = {
  payload: GuestDraft;
  exp: number;
};

function sign(secret: string, encoded: string): string {
  return createHmac('sha256', secret).update(encoded).digest('base64url');
}

export function encodeGuestDraft(payload: GuestDraft, secret: string, ttlHours: number): string {
  const envelope: Envelope = {
    payload,
    exp: Date.now() + ttlHours * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
  return `${encoded}.${sign(secret, encoded)}`;
}

export function decodeGuestDraft(value: string | undefined, secret: string): GuestDraft | null {
  if (!value) {
    return null;
  }
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature) {
    return null;
  }
  const expected = sign(secret, encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  try {
    const envelope = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Envelope;
    if (typeof envelope.exp !== 'number' || envelope.exp < Date.now()) {
      return null;
    }
    return envelope.payload;
  } catch {
    return null;
  }
}
