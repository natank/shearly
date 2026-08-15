export const PRICING_NAME = 'pricing';

export type PriceSplit = {
  gross: number;
  commission: number;
  net: number;
  commissionRate: number;
  travelIncluded: true;
};

export function splitPrice(grossMinor: number, commissionRate: number): PriceSplit {
  if (!Number.isInteger(grossMinor) || grossMinor < 0) {
    throw new Error('gross must be a non-negative integer');
  }
  if (commissionRate < 0 || commissionRate > 1) {
    throw new Error('commission rate out of range');
  }
  const commission = Math.round(grossMinor * commissionRate);
  return {
    gross: grossMinor,
    commission,
    net: grossMinor - commission,
    commissionRate,
    travelIncluded: true,
  };
}
