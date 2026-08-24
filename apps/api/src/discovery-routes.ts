import { Hono } from 'hono';
import type pg from 'pg';
import type { AppConfig } from '@shearly/shared-config';
import type { CatalogService } from '@shearly/services-provider-catalog';
import type { AvailabilityService } from '@shearly/services-availability';
import type { ProviderRanker } from '@shearly/domain-ranking';
import { ValidationError } from '@shearly/shared-errors';
import { insertOutboxEvent } from '@shearly/shared-events';
import { composeDiscovery, type DiscoveryFilters } from './discovery.js';
import { geocodeAddress } from './geocode.js';

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function createDiscoveryRoutes(input: {
  catalog: CatalogService;
  availability: AvailabilityService;
  ranker: ProviderRanker;
  config: AppConfig;
  pool: pg.Pool;
}) {
  const routes = new Hono();

  routes.get('/discovery', async (c) => {
    const q = c.req.query('q')?.trim() || undefined;
    const lat = optionalNumber(c.req.query('lat'));
    const lng = optionalNumber(c.req.query('lng'));
    if (!q && (lat === undefined || lng === undefined)) {
      return c.json({ state: 'need_location' });
    }

    let point = lat !== undefined && lng !== undefined ? { lat, lng } : null;
    if (!point && q) {
      const found = await geocodeAddress(input.config.geocoderUrl, q);
      if (!found) {
        throw new ValidationError('discovery.unknownAddress');
      }
      point = { lat: found.lat, lng: found.lng };
    }
    if (!point) {
      return c.json({ state: 'need_location' });
    }

    const filters: DiscoveryFilters = {
      service: c.req.query('service')?.trim() || undefined,
      minPrice: optionalNumber(c.req.query('minPrice')),
      maxPrice: optionalNumber(c.req.query('maxPrice')),
      minRating: optionalNumber(c.req.query('minRating')),
      date: c.req.query('date')?.trim() || undefined,
    };

    const result = await composeDiscovery({
      catalog: input.catalog,
      availability: input.availability,
      ranker: input.ranker,
      config: input.config,
      point,
      query: q ?? null,
      filters,
    });
    // OPS-006 (M5-P8b): funnel-stage event, best-effort — a real search
    // result must never be blocked by a funnel-counting write failing.
    await insertOutboxEvent(input.pool, 'catalog', 'DiscoverySearched', {
      hasResults: result.state === 'ok' && result.providers.length > 0,
    }).catch(() => undefined);
    return c.json(result);
  });

  return routes;
}
