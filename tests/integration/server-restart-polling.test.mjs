import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { io as createClient } from 'socket.io-client';

const dir = mkdtempSync(path.join(tmpdir(), 'matah-restart-polling-'));
// The store is read once, when the server module loads.
process.env.MATAH_SNAPSHOT_FILE = path.join(dir, 'rooms.json');
const { startServer, stopServer } = await import('../../server/src/index.ts');

let baseUrl;
const open = new Set();

/** A client that never upgrades, so every packet travels by long-polling. */
function pollingClient() {
  const socket = createClient(baseUrl, {
    transports: ['polling'],
    upgrade: false,
    forceNew: true,
    reconnection: false,
  });
  open.add(socket);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timeout')), 5_000);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
  });
}

function request(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} acknowledgement timeout`)), 5_000);
    const done = (result) => { clearTimeout(timer); resolve(result); };
    if (payload === undefined) socket.emit(event, done);
    else socket.emit(event, payload, done);
  });
}

before(async () => {
  baseUrl = `http://127.0.0.1:${await startServer(0)}`;
});

after(async () => {
  for (const socket of open) socket.disconnect();
  await stopServer();
  await rm(dir, { recursive: true, force: true });
});

test('a long-polling client in a room receives the restart notice before the server closes', async () => {
  const host = await pollingClient();
  assert.equal(host.io.engine.transport.name, 'polling', 'the client really is on polling');
  const created = await request(host, 'room:create', { language: 'en' });
  assert.equal(created.ok, true);

  const events = [];
  host.on('room:server-restarting', (acknowledge) => {
    events.push('notice');
    acknowledge();
  });
  const closed = new Promise((resolve) => host.once('disconnect', () => {
    events.push('disconnect');
    resolve();
  }));

  await stopServer();
  await closed;

  assert.deepEqual(events, ['notice', 'disconnect']);
  baseUrl = `http://127.0.0.1:${await startServer(0)}`;
});

test('while shutdown waits for acknowledgements, gameplay events are refused with server_busy', async () => {
  const host = await pollingClient();
  const created = await request(host, 'room:create', { language: 'en' });
  assert.equal(created.ok, true);

  let release;
  const noticeSeen = new Promise((resolve) => {
    host.on('room:server-restarting', (acknowledge) => {
      // Hold the acknowledgement so the server stays in its draining window.
      release = acknowledge;
      resolve();
    });
  });

  const stopping = stopServer();
  await noticeSeen;
  const refused = await request(host, 'room:setLanguage', { language: 'tr' });
  release();
  await stopping;

  assert.deepEqual(refused, { ok: false, error: 'server_busy' });
  baseUrl = `http://127.0.0.1:${await startServer(0)}`;
});
