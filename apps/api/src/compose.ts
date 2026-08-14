/**
 * Composition root (design §2.4).
 * The only place service implementations are constructed.
 * Empty in M0-P2 — no services wired yet.
 */
export function compose(): Record<string, never> {
  return {};
}
