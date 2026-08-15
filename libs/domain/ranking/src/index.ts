export const RANKING_NAME = 'ranking';

export type GeoPoint = { lat: number; lng: number };

export type RankableProvider = {
  providerId: string;
  distanceKm: number;
  nextSlotAt: Date | null;
  ratingAvg: number | null;
  reviewCount: number;
  completionCount: number;
};

export type RankingReason = {
  signal: 'distance' | 'availability' | 'rating' | 'completions';
  contribution: number;
};

export type RankingInput = {
  candidates: RankableProvider[];
  customerLocation: GeoPoint;
  requestedService?: string;
  requestedWindow?: { from: Date; to: Date };
  now?: Date;
};

export type RankedProvider = {
  providerId: string;
  score: number;
  reasons: RankingReason[];
};

export interface ProviderRanker {
  rank(input: RankingInput): Promise<RankedProvider[]>;
}

export type RankingWeights = {
  distance: number;
  availability: number;
  rating: number;
  completions: number;
  newProviderReviewThreshold: number;
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function scoreCandidate(
  candidate: RankableProvider,
  weights: RankingWeights,
  now: Date,
): RankedProvider {
  const distance = clamp01(1 - candidate.distanceKm / 15);
  const hours = candidate.nextSlotAt
    ? Math.max(0, (candidate.nextSlotAt.getTime() - now.getTime()) / 3_600_000)
    : 24 * 7;
  const availability = clamp01(1 - hours / (24 * 7));
  const prior = 3.5;
  const avg =
    candidate.reviewCount < weights.newProviderReviewThreshold || candidate.ratingAvg == null
      ? prior
      : candidate.ratingAvg;
  const confidence = clamp01(
    candidate.reviewCount / Math.max(weights.newProviderReviewThreshold, 1),
  );
  const rating = (avg / 5) * (0.5 + 0.5 * confidence);
  const completions = 1 - Math.exp(-candidate.completionCount / 10);
  const reasons: RankingReason[] = [
    { signal: 'distance', contribution: weights.distance * distance },
    { signal: 'availability', contribution: weights.availability * availability },
    { signal: 'rating', contribution: weights.rating * rating },
    { signal: 'completions', contribution: weights.completions * completions },
  ];
  return {
    providerId: candidate.providerId,
    score: reasons.reduce((sum, reason) => sum + reason.contribution, 0),
    reasons,
  };
}

export class DeterministicRanker implements ProviderRanker {
  constructor(private readonly weights: RankingWeights) {}

  async rank(input: RankingInput): Promise<RankedProvider[]> {
    const now = input.now ?? new Date();
    return input.candidates
      .map((candidate) => scoreCandidate(candidate, this.weights, now))
      .sort(
        (left, right) =>
          right.score - left.score || left.providerId.localeCompare(right.providerId),
      );
  }
}

export class StubRanker implements ProviderRanker {
  async rank(input: RankingInput): Promise<RankedProvider[]> {
    return [...input.candidates].reverse().map((candidate, index) => ({
      providerId: candidate.providerId,
      score: input.candidates.length - index,
      reasons: [],
    }));
  }
}

export function defaultDistanceThenRating(candidates: RankableProvider[]): RankableProvider[] {
  return [...candidates].sort(
    (left, right) =>
      left.distanceKm - right.distanceKm ||
      (right.ratingAvg ?? 0) - (left.ratingAvg ?? 0) ||
      left.providerId.localeCompare(right.providerId),
  );
}
