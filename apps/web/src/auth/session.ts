import { cookies } from 'next/headers';
import type { PublicAccount } from '@shearly/contracts-identity';

const apiBase = 'http://127.0.0.1:4000';

export async function getSession(): Promise<PublicAccount | null> {
  try {
    const cookie = (await cookies()).toString();
    const res = await fetch(`${apiBase}/api/me`, {
      headers: { cookie },
      cache: 'no-store',
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { account?: PublicAccount };
    return body.account ?? null;
  } catch {
    return null;
  }
}
