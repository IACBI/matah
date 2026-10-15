import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';

import { clients } from '../helpers/socket.mjs';
import { probePort } from '../helpers/port.mjs';

const TOKEN = 'stats-token-for-tests-0123456789';
const port = await probePort();
const url = `http://127.0.0.1:${port}`;
process.env.NODE_ENV = 'production';
process.env.PUBLIC_ORIGIN = url;
process.env.MATAH_STATS_TOKEN = TOKEN;
const { startServer, stopServer } = await import('../../server/src/index.ts');

const { connect: openSocket, ack, until, disconnectAll } = clients(() => url);
const connect = () => openSocket({ Origin: url });

before(() => startServer(port));
after(async () => {
  disconnectAll();
  await stopServer();
});

const stats = (headers) => fetch(`${url}/stats`, { headers });

test('stats refuses a request without the token, and says how to authenticate', async () => {
  const anonymous = await stats();
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get('www-authenticate'), 'Bearer');
  assert.equal(anonymous.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await anonymous.json(), { error: 'unauthorized' });

  for (const authorization of [
    'Bearer wrong-token-of-a-similar-length-x',
    `Bearer ${TOKEN}x`,
    `bearer ${TOKEN}`,
    TOKEN,
    'Bearer',
  ]) {
    assert.equal((await stats({ Authorization: authorization })).status, 401, authorization);
  }
});

test('stats reports load without naming a room, a player or an address', async () => {
  const host = await connect();
  const created = await ack(host, 'room:create', { language: 'en' });
  assert.equal(created.ok, true);
  const guest = await connect();
  const seated = until(host, (state) => state.players.length === 1, 'the guest');
  const joined = await ack(guest, 'room:join', {
    code: created.data.code,
    name: 'Distinctive Guest Name',
    avatar: 'fox',
  });
  assert.equal(joined.ok, true);
  await seated;

  const response = await stats({ Authorization: `Bearer ${TOKEN}` });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();

  assert.equal(body.rooms.total, 1);
  assert.equal(body.rooms.inLobby, 1);
  assert.equal(body.rooms.inGame, 0);
  assert.equal(body.rooms.limit, 500);
  assert.equal(body.players, 1, 'the guest; the host screen is a socket but not a player');
  assert.equal(body.connections.sockets, 2);
  assert.equal(body.connections.addresses, 1);
  assert.ok(body.uptimeSeconds >= 0);
  assert.ok(body.memoryMb.rss > 0 && body.memoryMb.heapUsed > 0);
  assert.deepEqual(body.persistence, { enabled: false, lastSavedAt: null });

  const text = JSON.stringify(body);
  assert.ok(!text.includes(created.data.code), 'no room code');
  assert.ok(!text.includes('Distinctive Guest Name'), 'no player name');
  assert.ok(!text.includes('127.0.0.1'), 'no client address');
});

test('stats counts shed actions, so a flood is visible', async () => {
  const read = async () =>
    (await stats({ Authorization: `Bearer ${TOKEN}` })).json();
  const before = await read();
  assert.deepEqual(before.errors, { handlers: 0, snapshotSaves: 0 });
  assert.equal(before.refused.connectionsBusy, 0);

  const socket = await connect();
  // A socket holds 20 actions and earns 10 a second; 60 at once overdraws it.
  const results = await Promise.all(Array.from({ length: 60 }, () => ack(socket, 'room:leave')));
  const throttled = results.filter((r) => !r.ok && r.error === 'rate_limited').length;
  assert.ok(throttled > 0, 'the burst must overdraw the bucket');

  const after = await read();
  assert.equal(after.refused.actionsRateLimited - before.refused.actionsRateLimited, throttled);
});

test('a token too short to resist guessing stops the boot', () => {
  const entry = pathToFileURL(
    path.resolve(fileURLToPath(import.meta.url), '../../../server/src/index.ts'),
  ).href;
  const run = (env) =>
    spawnSync(process.execPath, ['--import', 'tsx', '-e', `await import(${JSON.stringify(entry)})`], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      timeout: 30_000,
    });

  const tooShort = run({ MATAH_STATS_TOKEN: 'short' });
  assert.notEqual(tooShort.status, 0);
  assert.match(tooShort.stderr, /MATAH_STATS_TOKEN must be at least 24 characters/);
});
