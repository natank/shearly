import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// NFR-UX-005: no placeholder/lorem/stub text should ever be reachable —
// every translation value is a real, final string, not a TODO left behind
// during a build-out pass. Distinct from check-hardcoded-strings.mjs
// (which finds JSX text that never went through t() at all): this scans
// the translation values themselves for stub content that *did* go
// through i18n but was never actually written.
const messagesRoot = 'libs/ui/i18n/src/messages';

const patterns = [
  /\blorem ipsum\b/i,
  /\btodo\b/i,
  /\btbd\b/i,
  /\bplaceholder\b/i,
  /\bfixme\b/i,
  /\bxxx\b/i,
  /\blipsum\b/i,
  /\bwip\b/i,
  /\bdummy text\b/i,
  /\bsample text\b/i,
];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else if (name.endsWith('.json')) {
      acc.push(full);
    }
  }
  return acc;
}

function flatten(obj, prefix, acc) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      acc.push([path, value]);
    } else if (value && typeof value === 'object') {
      flatten(value, path, acc);
    }
  }
  return acc;
}

const hits = [];
for (const file of walk(messagesRoot)) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  for (const [key, value] of flatten(parsed, '', [])) {
    for (const pattern of patterns) {
      if (pattern.test(value)) {
        hits.push(`${file}: ${key} = ${JSON.stringify(value)}`);
        break;
      }
    }
  }
}

if (hits.length) {
  console.error('Placeholder/stub text in translations (NFR-UX-005):\n' + hits.join('\n'));
  process.exit(1);
}
console.log('No placeholder text in translations.');
