import type { AppConfig } from '@shearly/shared-config';
import type {
  CatalogService,
  ListedProvider,
  ServiceRow,
} from '@shearly/services-provider-catalog';
import type { AvailabilityService } from '@shearly/services-availability';
import {
  defaultDistanceThenRating,
  type ProviderRanker,
  type RankableProvider,
  type RankedProvider,
} from '@shearly/domain-ranking';

export type DiscoveryFilters = {
  service?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  date?: string;
};

export type DiscoveryResult =
  | { state: 'need_location' }
  | { state: 'out_of_area'; query: string | null; point: { lat: number; lng: number } }
  | { state: 'no_matches'; filters: DiscoveryFilters }
  | {
      state: 'ok';
      point: { lat: number; lng: number };
      providers: DiscoveryCard[];
    };

export type DiscoveryCard = {
  id: string;
  displayName: string;
  photoUrl: string | null;
  headlinePriceMinor: number | null;
  rating: number | null;
  reviewCount: number;
  newProvider: boolean;
  nextSlot: string | null;
  distanceKm: number;
  reasons: RankedProvider['reasons'];
};

export function activeFilters(filters: DiscoveryFilters): string[] {
  return (['service', 'minPrice', 'maxPrice', 'minRating', 'date'] as const).filter(
    (key) => filters[key] !== undefined && filters[key] !== '',
  );
}

function ratingAvg(provider: ListedProvider): number | null {
  if (provider.rating_count < 1) {
    return null;
  }
  return provider.rating_sum / provider.rating_count;
}

function onDate(iso: string, date: string): boolean {
  return iso.slice(0, 10) === date;
}

export async function composeDiscovery(input: {
  catalog: CatalogService;
  availability: AvailabilityService;
  ranker: ProviderRanker;
  config: AppConfig;
  point: { lat: number; lng: number };
  query: string | null;
  filters: DiscoveryFilters;
  now?: Date;
}): Promise<DiscoveryResult> {
  const listed = await input.catalog.listInRadius(input.point);
  if (!listed.length) {
    return { state: 'out_of_area', query: input.query, point: input.point };
  }

  const now = input.now ?? new Date();
  const windowMs = input.config.discoveryWindowDays * 24 * 60 * 60 * 1000;
  const from = now;
  const to = new Date(now.getTime() + windowMs);
  const kept: {
    provider: ListedProvider;
    services: ServiceRow[];
    nextSlotAt: Date | null;
    photoId: string | null;
  }[] = [];

  for (const provider of listed) {
    const services = await input.catalog.listServicesForProvider(provider.id);
    if (input.filters.service) {
      const needle = input.filters.service.toLowerCase();
      if (!services.some((service) => service.name.toLowerCase().includes(needle))) {
        continue;
      }
    }
    const headline = services.reduce<number | null>((min, service) => {
      if (min === null || service.price_minor < min) {
        return service.price_minor;
      }
      return min;
    }, null);
    if (
      input.filters.minPrice !== undefined &&
      (headline ?? 0) < Math.round(input.filters.minPrice * 100)
    ) {
      continue;
    }
    if (
      input.filters.maxPrice !== undefined &&
      (headline ?? Infinity) > Math.round(input.filters.maxPrice * 100)
    ) {
      continue;
    }
    const average = ratingAvg(provider);
    if (input.filters.minRating !== undefined && (average ?? 0) < input.filters.minRating) {
      continue;
    }
    const duration = services[0]?.duration_minutes ?? 60;
    const slots = await input.availability.slots(provider.account_id, {
      durationMinutes: duration,
      from,
      to,
      now,
    });
    if (
      input.filters.date &&
      !slots.some((slot) => onDate(slot.start.toISOString(), input.filters.date ?? ''))
    ) {
      continue;
    }
    const photos = await input.catalog.listPortfolioMeta(provider.id);
    kept.push({
      provider,
      services,
      nextSlotAt: slots[0]?.start ?? null,
      photoId: photos[0]?.id ?? null,
    });
  }

  if (!kept.length) {
    return { state: 'no_matches', filters: input.filters };
  }

  const candidates: RankableProvider[] = kept.map((row) => ({
    providerId: row.provider.id,
    distanceKm: row.provider.distance_km,
    nextSlotAt: row.nextSlotAt,
    ratingAvg: ratingAvg(row.provider),
    reviewCount: row.provider.rating_count,
    completionCount: row.provider.completion_count,
  }));

  let ranked: RankedProvider[];
  try {
    ranked = await Promise.race([
      input.ranker.rank({
        candidates,
        customerLocation: input.point,
        requestedService: input.filters.service,
        now,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('ranking.timeout')), input.config.rankingTimeoutMs);
      }),
    ]);
  } catch {
    ranked = defaultDistanceThenRating(candidates).map((candidate) => ({
      providerId: candidate.providerId,
      score: 0,
      reasons: [],
    }));
  }

  const byId = new Map(kept.map((row) => [row.provider.id, row]));
  const providers: DiscoveryCard[] = [];
  for (const item of ranked) {
    const row = byId.get(item.providerId);
    if (!row) {
      continue;
    }
    const average = ratingAvg(row.provider);
    const headline = row.services.reduce<number | null>((min, service) => {
      if (min === null || service.price_minor < min) {
        return service.price_minor;
      }
      return min;
    }, null);
    providers.push({
      id: row.provider.id,
      displayName: row.provider.display_name || '',
      photoUrl: row.photoId
        ? `/api/catalog/public/${row.provider.id}/portfolio/${row.photoId}`
        : null,
      headlinePriceMinor: headline,
      rating: average,
      reviewCount: row.provider.rating_count,
      newProvider: row.provider.rating_count < input.config.newProviderReviewThreshold,
      nextSlot: row.nextSlotAt?.toISOString() ?? null,
      distanceKm: row.provider.distance_km,
      reasons: item.reasons,
    });
  }

  return { state: 'ok', point: input.point, providers };
}
