import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fixtures = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures.json'), 'utf8'),
);

export function lookup(query) {
  const key = query.trim().toLowerCase().replace(/\s+/g, '-');
  return fixtures[key] ?? null;
}

const port = Number(process.env.PORT ?? 3001);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/geocode') {
    const place = lookup(url.searchParams.get('q') ?? '');
    if (!place) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(place));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`geocoder-stub listening on ${port}\n`);
  });
}
