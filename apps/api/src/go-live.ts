export type GoLiveMissing = 'vetting' | 'connect' | 'services' | 'availability';

export function evaluateGoLive(input: {
  approved: boolean;
  connectComplete: boolean;
  serviceCount: number;
  hasAvailability: boolean;
}): { ready: boolean; missing: GoLiveMissing[] } {
  const missing: GoLiveMissing[] = [];
  if (!input.approved) {
    missing.push('vetting');
  }
  if (!input.connectComplete) {
    missing.push('connect');
  }
  if (input.serviceCount < 1) {
    missing.push('services');
  }
  if (!input.hasAvailability) {
    missing.push('availability');
  }
  return { ready: missing.length === 0, missing };
}
