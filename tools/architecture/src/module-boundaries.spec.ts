import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('module boundaries', () => {
  it('rejects type:app-web importing a type:service', async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const fixture = join(repoRoot, 'tools/architecture-fixtures/src/illegal-service-import.ts');
    const results = await eslint.lintFiles([fixture]);
    const messages = results.flatMap((r) => r.messages);
    const boundaryHits = messages.filter((m) => m.ruleId === '@nx/enforce-module-boundaries');
    expect(boundaryHits.length).toBeGreaterThan(0);
  });

  it('rejects process.env outside shared-config', async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const fixture = join(repoRoot, 'tools/architecture-fixtures/src/illegal-process-env.ts');
    const results = await eslint.lintFiles([fixture]);
    const messages = results.flatMap((r) => r.messages);
    expect(messages.some((m) => m.ruleId === 'no-restricted-syntax')).toBe(true);
  });

  it('rejects physical CSS in a fixture', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/check-physical-styles.mjs', 'tools/architecture-fixtures/src'],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('margin-left');
  });

  it('keeps type:domain free of shared, service, and ui imports', () => {
    const domainRoot = join(repoRoot, 'libs/domain');
    const forbidden = [
      '@shearly/shared-',
      '@shearly/services-',
      '@shearly/ui-',
      '@shearly/feature-',
      '@shearly/contracts-',
    ];
    const offenders: string[] = [];
    for (const file of walkTsFiles(domainRoot)) {
      const text = readFileSync(file, 'utf8');
      for (const needle of forbidden) {
        if (text.includes(needle)) {
          offenders.push(`${file} → ${needle}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
