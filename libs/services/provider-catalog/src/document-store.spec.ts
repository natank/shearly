import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FsDocumentStore } from './document-store.js';

describe('FsDocumentStore', () => {
  it('round-trips bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shearly-docs-'));
    try {
      const store = new FsDocumentStore(dir);
      await store.put('a/b.bin', Buffer.from('hello'));
      expect((await store.get('a/b.bin')).toString()).toBe('hello');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
