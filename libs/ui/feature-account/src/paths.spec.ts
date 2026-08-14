import { describe, expect, it } from 'vitest';
import { homePathForRole } from './paths.js';

describe('homePathForRole', () => {
  it('sends providers to /provider and everyone else to /account', () => {
    expect(homePathForRole('provider')).toBe('/provider');
    expect(homePathForRole('customer')).toBe('/account');
    expect(homePathForRole('admin')).toBe('/account');
  });
});
