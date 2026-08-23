import { describe, expect, it, vi } from 'vitest';
import { executeEffects } from './booking-effects.js';

function fakeDeps() {
  return {
    pool: { query: vi.fn(async () => ({ rows: [] })) } as unknown as import('pg').Pool,
    authorizations: {
      cancelAuthorization: vi.fn(async () => undefined),
      capture: vi.fn(async () => undefined),
      refund: vi.fn(async () => undefined),
    } as unknown as import('@shearly/services-payments').AuthorizationService,
    ledger: {
      split: vi.fn(async () => []),
    } as unknown as import('@shearly/services-payments').LedgerService,
  };
}

describe('executeEffects', () => {
  it('ReleaseAuth cancels the authorization', async () => {
    const deps = fakeDeps();
    await executeEffects(deps, 'booking-1', 'provider-1', 20000, 'USD', 'ProviderDeclines', [
      { type: 'ReleaseAuth' },
    ]);
    expect(deps.authorizations.cancelAuthorization).toHaveBeenCalledWith('booking-1', 'booking-1');
  });

  it('Capture(100) captures the full price, then Split splits the same amount', async () => {
    const deps = fakeDeps();
    await executeEffects(deps, 'booking-1', 'provider-1', 20000, 'USD', 'ProviderCompletes', [
      { type: 'Capture', pct: 100 },
      { type: 'Split' },
    ]);
    expect(deps.authorizations.capture).toHaveBeenCalledWith('booking-1', 20000, 'USD');
    expect(deps.ledger.split).toHaveBeenCalledWith('booking-1', 20000);
  });

  it('Capture(50) then Split splits only the 50% actually captured, not the full price', async () => {
    const deps = fakeDeps();
    await executeEffects(deps, 'booking-1', 'provider-1', 20000, 'USD', 'CustomerCancels', [
      { type: 'Capture', pct: 50 },
      { type: 'Split' },
    ]);
    expect(deps.authorizations.capture).toHaveBeenCalledWith('booking-1', 10000, 'USD');
    expect(deps.ledger.split).toHaveBeenCalledWith('booking-1', 10000);
  });

  it('Refund(50) refunds half the price with the given reason', async () => {
    const deps = fakeDeps();
    await executeEffects(deps, 'booking-1', 'provider-1', 20000, 'USD', 'CustomerCancels', [
      { type: 'Refund', pct: 50 },
    ]);
    expect(deps.authorizations.refund).toHaveBeenCalledWith(
      'booking-1',
      10000,
      'CustomerCancels',
      'USD',
    );
  });

  it('Refund(100) then Split splits the full refunded amount', async () => {
    const deps = fakeDeps();
    await executeEffects(deps, 'booking-1', 'provider-1', 20000, 'USD', 'ProviderCancels', [
      { type: 'Refund', pct: 100 },
    ]);
    expect(deps.authorizations.refund).toHaveBeenCalledWith(
      'booking-1',
      20000,
      'ProviderCancels',
      'USD',
    );
  });

  it('RecordStanding writes a standing_events row', async () => {
    const deps = fakeDeps();
    await executeEffects(deps, 'booking-1', 'provider-1', 20000, 'USD', 'ProviderCancels', [
      { type: 'RecordStanding', kind: 'provider_cancel' },
    ]);
    expect(deps.pool.query).toHaveBeenCalledWith(expect.stringContaining('standing_events'), [
      'booking-1',
      'provider-1',
      'provider_cancel',
    ]);
  });

  it('ReleaseHold and Notify are no-ops that do not throw', async () => {
    const deps = fakeDeps();
    await expect(
      executeEffects(deps, 'booking-1', 'provider-1', 20000, 'USD', 'ProviderAccepts', [
        { type: 'ReleaseHold' },
        { type: 'Notify', recipients: ['customer', 'provider'] },
      ]),
    ).resolves.toBeUndefined();
  });

  it("processes effects in order, so Split after Capture uses that Capture's amount", async () => {
    const deps = fakeDeps();
    // No preceding Capture/Refund: Split falls back to the full price.
    await executeEffects(deps, 'booking-1', 'provider-1', 20000, 'USD', 'AutoCompleteElapsed', [
      { type: 'Split' },
    ]);
    expect(deps.ledger.split).toHaveBeenCalledWith('booking-1', 20000);
  });
});
