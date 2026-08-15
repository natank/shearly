import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.next') {
      continue;
    }
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else if (/\.(ts|tsx|js|mjs)$/.test(name) && !name.includes('.spec.')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('ranking seam', () => {
  it('imports a concrete ranker only from the composition root', () => {
    const files = [...walk(join(repoRoot, 'apps')), ...walk(join(repoRoot, 'libs'))];
    const hits = files.filter((file) => {
      if (file.includes(`${join('libs', 'domain', 'ranking')}`)) {
        return false;
      }
      const text = readFileSync(file, 'utf8');
      return text.includes('DeterministicRanker') || text.includes('StubRanker');
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const file of hits) {
      expect(file.endsWith(`${join('apps', 'api', 'src', 'compose.ts')}`)).toBe(true);
    }
  });
});
