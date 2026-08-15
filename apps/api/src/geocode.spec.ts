import { afterEach, describe, expect, it, vi } from 'vitest';
import { geocodeAddress } from './geocode.js';

describe('geocodeAddress', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a stub point and maps unknown queries to null', async () => {
    vi.stubGlobal('fetch', async (input: URL) => {
      if (input.searchParams.get('q') === 'tel-aviv') {
        return new Response(
          JSON.stringify({ lat: 32.0853, lng: 34.7818, label: 'Tel Aviv-Yafo' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    });
    await expect(geocodeAddress('http://127.0.0.1:3001', 'tel-aviv')).resolves.toMatchObject({
      lat: 32.0853,
      lng: 34.7818,
    });
    await expect(geocodeAddress('http://127.0.0.1:3001', 'nowhere')).resolves.toBeNull();
  });
});
