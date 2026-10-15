import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { clients } from '../helpers/socket.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'matah-restart-notice-'));
// The store is read once, when the server module loads.
process.env.MATAH_SNAPSHOT_FILE = path.join(dir, 'rooms.json');
const { startServer, stopServer } = await import('../../server/src/index.ts');

let baseUrl;
const { connect, ack, disconnectAll } = clients(() => baseUrl);

async function start() {
  const port = await startServer(0);
  baseUrl = `http://127.0.0.1:${port}`;
}

function within(promise, label, ms = 3_000) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

before(start);

after(async () => {
  disconnectAll();
  await stopServer();
  await rm(dir, { recursive: true, force: true });
});

test('stopServer resolves quickly when no socket is connected', async () => {
  const began = performance.now();
  await stopServer();
  const elapsed = performance.now() - began;
  assert.ok(elapsed < 500, `stopServer took ${elapsed.toFixed(0)} ms with no sockets`);
  await start();
});

test('a client in a room hears the notice once, acknowledges it, and is then disconnected', async () => {
  const host = await connect();
  const created = await ack(host, 'room:create', { language: 'en' });
  assert.equal(created.ok, true);

  const events = [];
  host.on('room:server-restarting', (acknowledge) => {
    events.push('notice');
    // A real client acknowledges so the server knows the notice left.
    acknowledge();
  });
  const closed = within(
    new Promise((resolve) => host.once('disconnect', () => {
      events.push('disconnect');
      resolve();
    })),
    'the disconnect',
  );

  const began = performance.now();
  await stopServer();
  await closed;

  assert.deepEqual(events, ['notice', 'disconnect']);
  assert.ok(performance.now() - began < 400, 'an acknowledging client does not make shutdown wait out the timeout');
  await start();
});

test('a socket that is not in a room is not told its game was saved', async () => {
  const lurker = await connect();
  const heard = [];
  lurker.on('room:server-restarting', () => heard.push('notice'));
  const closed = within(new Promise((resolve) => lurker.once('disconnect', resolve)), 'the disconnect');

  await stopServer();
  await closed;

  assert.deepEqual(heard, []);
  await start();
});
