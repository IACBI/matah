import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = mkdtempSync(path.join(tmpdir(), 'matah-unreadable-'));
const SNAPSHOT_FILE = path.join(dir, 'rooms.json');
const UNREADABLE = '{"version": 1, "rooms": [';
// The store is read once, when the server module loads.
process.env.MATAH_SNAPSHOT_FILE = SNAPSHOT_FILE;
await writeFile(SNAPSHOT_FILE, UNREADABLE);
const server = await import('../../server/src/index.ts');

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('a snapshot that failed to load is not overwritten by an empty shutdown save', async () => {
  const port = await server.startServer(0);
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200, 'the server still serves after a failed restore');

  await server.stopServer();

  assert.equal(
    await readFile(SNAPSHOT_FILE, 'utf8'),
    UNREADABLE,
    'the unreadable file is left for an operator to recover',
  );
});
