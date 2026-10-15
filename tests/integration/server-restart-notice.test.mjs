import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { clients } from '../helpers/socket.mjs';

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
});

test('stopServer resolves quickly when no socket is connected', async () => {
  const began = performance.now();
  await stopServer();
  const elapsed = performance.now() - began;
  assert.ok(elapsed < 500, `stopServer took ${elapsed.toFixed(0)} ms with no sockets`);
  await start();
});

test('a connected client hears the restart notice once, before it is disconnected', async () => {
  const host = await connect();
  const created = await ack(host, 'room:create', { language: 'en' });
  assert.equal(created.ok, true);

  const received = [];
  host.on('room:server-restarting', () => received.push('notice'));
  const noticed = within(
    new Promise((resolve) => host.once('room:server-restarting', resolve)),
    'room:server-restarting',
  );
  const closed = within(
    new Promise((resolve) => host.once('disconnect', () => {
      received.push('disconnect');
      resolve();
    })),
    'the disconnect',
  );

  await stopServer();
  await noticed;
  await closed;

  assert.deepEqual(received, ['notice', 'disconnect']);
});
