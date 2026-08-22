import { describe, expect, it } from 'vitest';
import { loadConfig } from './index.js';

const valid = {
  DATABASE_URL: 'postgres://shearly:shearly@localhost:5432/shearly',
  GEOCODER_URL: 'http://127.0.0.1:3001',
  SMTP_URL: 'smtp://127.0.0.1:1025',
};

describe('loadConfig', () => {
  it('fails fast when required vars are missing', () => {
    expect(() => loadConfig({})).toThrow(/Invalid configuration/);
  });

  it('applies market defaults', () => {
    const config = loadConfig(valid);
    expect(config.currency).toBe('ILS');
    expect(config.radiusCapKm).toBe(15);
    expect(config.commissionRate).toBe(0.2);
    expect(config.apiPort).toBe(4000);
    expect(config.passwordMinLength).toBe(10);
    expect(config.sessionCookieName).toBe('shearly_session');
    expect(config.rankingImpl).toBe('deterministic');
    expect(config.rankWeightDistance).toBe(0.4);
    expect(config.newProviderReviewThreshold).toBe(3);
    expect(config.authHorizonDays).toBe(6);
    expect(config.bookingResponseWindowHours).toBe(2);
    expect(config.autoCompleteWindowHours).toBe(2);
    expect(config.cancelFullRefundHours).toBe(12);
  });
});
