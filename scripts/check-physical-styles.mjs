import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = process.argv.slice(2);
const cssProps = /\b(margin-left|margin-right|padding-left|padding-right)\s*:/g;
const tw = /\b(ml|mr|pl|pr|left|right|text-left|text-right|float-left|float-right)-/g;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules' && name !== '.next' && name !== 'dist') walk(full, acc);
    } else if (/\.(css|ts|tsx|js|jsx)$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

const hits = [];
for (const root of roots) {
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (cssProps.test(line) || tw.test(line)) {
        hits.push(`${file}:${i + 1}: ${line.trim()}`);
      }
      cssProps.lastIndex = 0;
      tw.lastIndex = 0;
    });
  }
}

if (hits.length) {
  console.error('Physical direction styles (NFR-I18N-002):\n' + hits.join('\n'));
  process.exit(1);
}
console.log('No physical direction styles.');
