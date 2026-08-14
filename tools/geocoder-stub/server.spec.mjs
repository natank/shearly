import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lookup } from './server.mjs';

describe('geocoder stub', () => {
  it('returns the Tel Aviv fixture', () => {
    assert.deepEqual(lookup('tel-aviv'), {
      lat: 32.0853,
      lng: 34.7818,
      label: 'Tel Aviv-Yafo',
    });
  });

  it('normalizes spaces', () => {
    assert.equal(lookup('Tel Aviv').label, 'Tel Aviv-Yafo');
  });

  it('returns null for unknown places', () => {
    assert.equal(lookup('nowhere'), null);
  });
});
