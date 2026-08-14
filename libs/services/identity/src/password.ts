import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const KEY_LEN = 32;
const N = 16384;
const R = 8;
const P = 1;

function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derived) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derived);
    });
  });
}

export function assertPasswordPolicy(password: string, minLength: number): void {
  if (password.length < minLength) {
    throw Object.assign(new Error('password too short'), { code: 'PASSWORD_TOO_SHORT' });
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  const expected = Buffer.from(hashHex, 'hex');
  const hash = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, {
    N: Number(nRaw),
    r: Number(rRaw),
    p: Number(pRaw),
  });
  if (hash.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(hash, expected);
}

let dummyHash: string | undefined;

export async function dummyVerify(password: string): Promise<void> {
  dummyHash ??= await hashPassword('shearly-dummy-password');
  await verifyPassword(password, dummyHash);
}
