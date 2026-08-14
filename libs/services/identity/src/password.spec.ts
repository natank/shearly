import { describe, expect, it } from 'vitest';
import { assertPasswordPolicy, dummyVerify, hashPassword, verifyPassword } from './password.js';

describe('password', () => {
  it('rejects passwords shorter than the configured minimum', () => {
    expect(() => assertPasswordPolicy('short', 10)).toThrow(/too short/);
    expect(() => assertPasswordPolicy('long-enough-password', 10)).not.toThrow();
  });

  it('verifies a hash of the same password', async () => {
    const hash = await hashPassword('correct-horse');
    expect(await verifyPassword('correct-horse', hash)).toBe(true);
    expect(await verifyPassword('wrong-horse', hash)).toBe(false);
    expect(await verifyPassword('correct-horse', 'not-a-hash')).toBe(false);
  });

  it('dummyVerify always runs a compare', async () => {
    await expect(dummyVerify('anything')).resolves.toBeUndefined();
  });
});
