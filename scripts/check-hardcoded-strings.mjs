import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const roots = [
  'apps/web',
  'apps/admin',
  'libs/ui/feature-discovery',
  'libs/ui/feature-booking',
  'libs/ui/feature-provider',
  'libs/ui/feature-account',
];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules' && name !== '.next') walk(full, acc);
    } else if (/\.(tsx|jsx)$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

const hits = [];
for (const root of roots) {
  let files = [];
  try {
    files = walk(root);
  } catch {
    continue;
  }
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if (ts.isJsxText(node)) {
        const value = node.getText().trim();
        if (value.length > 0) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          hits.push(`${file}:${line + 1}: ${JSON.stringify(value)}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}

if (hits.length) {
  console.error('Hardcoded JSX text (NFR-I18N-001):\n' + hits.join('\n'));
  process.exit(1);
}
console.log('No hardcoded JSX text.');
