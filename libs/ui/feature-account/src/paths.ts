import type { AccountRole } from '@shearly/contracts-identity';

export function homePathForRole(role: AccountRole): '/account' | '/provider' {
  return role === 'provider' ? '/provider' : '/account';
}
