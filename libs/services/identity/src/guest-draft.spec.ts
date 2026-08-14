import { describe, expect, it } from 'vitest';
import { decodeGuestDraft, encodeGuestDraft } from './guest-draft.js';

describe('guest draft cookie', () => {
  const secret = 'test-guest-draft-secret';

  it('round-trips a payload', () => {
    const encoded = encodeGuestDraft({ providerId: 'p1', slotId: 's1' }, secret, 2);
    expect(decodeGuestDraft(encoded, secret)).toEqual({ providerId: 'p1', slotId: 's1' });
  });

  it('rejects a tampered cookie', () => {
    const encoded = encodeGuestDraft({ addressLabel: 'Home' }, secret, 2);
    expect(decodeGuestDraft(`${encoded}x`, secret)).toBeNull();
    expect(decodeGuestDraft(undefined, secret)).toBeNull();
  });
});
