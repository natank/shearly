import { describe, expect, it } from 'vitest';
import {
  defaultDistanceThenRating,
  DeterministicRanker,
  RANKING_NAME,
  StubRanker,
  type RankableProvider,
  type RankingWeights,
} from './index.js';

const weights: RankingWeights = {
  distance: 0.4,
  availability: 0.3,
  rating: 0.2,
  completions: 0.1,
  newProviderReviewThreshold: 3,
};

const now = new Date('2026-08-15T09:00:00.000Z');

function candidate(partial: Partial<RankableProvider> & { providerId: string }): RankableProvider {
  return {
    distanceKm: 5,
    nextSlotAt: new Date('2026-08-15T12:00:00.000Z'),
    ratingAvg: 5,
    reviewCount: 10,
    completionCount: 20,
    ...partial,
  };
}

describe('ranking', () => {
  it('exports its name', () => {
    expect(RANKING_NAME).toBe('ranking');
  });

  it('ranks nearer and sooner providers higher', async () => {
    const ranker = new DeterministicRanker(weights);
    const ranked = await ranker.rank({
      customerLocation: { lat: 32.08, lng: 34.78 },
      now,
      candidates: [
        candidate({
          providerId: 'far',
          distanceKm: 14,
          nextSlotAt: new Date('2026-08-21T09:00:00.000Z'),
        }),
        candidate({
          providerId: 'near',
          distanceKm: 1,
          nextSlotAt: new Date('2026-08-15T10:00:00.000Z'),
        }),
      ],
    });
    expect(ranked.map((row) => row.providerId)).toEqual(['near', 'far']);
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });

  it('is deterministic and tie-breaks by provider id', async () => {
    const ranker = new DeterministicRanker(weights);
    const twins = [candidate({ providerId: 'b' }), candidate({ providerId: 'a' })];
    const first = await ranker.rank({
      customerLocation: { lat: 32.08, lng: 34.78 },
      now,
      candidates: twins,
    });
    const second = await ranker.rank({
      customerLocation: { lat: 32.08, lng: 34.78 },
      now,
      candidates: twins,
    });
    expect(first.map((row) => row.providerId)).toEqual(['a', 'b']);
    expect(second).toEqual(first);
  });

  it('does not penalize new providers versus a sparse average', async () => {
    const ranker = new DeterministicRanker(weights);
    const ranked = await ranker.rank({
      customerLocation: { lat: 32.08, lng: 34.78 },
      now,
      candidates: [
        candidate({ providerId: 'new', ratingAvg: 5, reviewCount: 1, completionCount: 0 }),
        candidate({ providerId: 'established', ratingAvg: 5, reviewCount: 20, completionCount: 0 }),
      ],
    });
    expect(ranked[0]?.providerId).toBe('established');
    expect(ranked.find((row) => row.providerId === 'new')).toBeTruthy();
  });

  it('reverses incoming order when the stub ranker is used', async () => {
    const stub = new StubRanker();
    const ranked = await stub.rank({
      customerLocation: { lat: 32.08, lng: 34.78 },
      candidates: [candidate({ providerId: 'first' }), candidate({ providerId: 'second' })],
    });
    expect(ranked.map((row) => row.providerId)).toEqual(['second', 'first']);
  });

  it('falls back to distance then rating', () => {
    const ordered = defaultDistanceThenRating([
      candidate({ providerId: 'far-high', distanceKm: 10, ratingAvg: 5 }),
      candidate({ providerId: 'near-low', distanceKm: 2, ratingAvg: 3 }),
    ]);
    expect(ordered.map((row) => row.providerId)).toEqual(['near-low', 'far-high']);
  });
});
