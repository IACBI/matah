import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { io as createClient } from 'socket.io-client';

import { probePort } from '../helpers/port.mjs';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
// The SPA metadata test needs a real bundle; the origin and rate-limit tests
// do not. Keep the suite runnable on a fresh clone that has not built yet.
const clientBuilt = existsSync(path.join(repoRoot, 'client/dist/index.html'));

// PUBLIC_ORIGIN is read once at module load and must match the listening port,
// so this suite cannot retry onto a different port the way the others can.
const port = await probePort();
const url = `http://127.0.0.1:${port}`;
process.env.NODE_ENV = 'production';
process.env.PUBLIC_ORIGIN = url;
// Pin the create limit so the assertion below tests the limiter rather than
// whatever the shipped default happens to be.
const CREATE_LIMIT = 5;
process.env.MATAH_RL_CREATE = String(CREATE_LIMIT);
const { startServer, stopServer } = await import('../../server/src/index.ts');
const sockets = [];

before(() => startServer(port));
after(async () => {
  for (const socket of sockets) socket.disconnect();
  await stopServer();
});

function connect(origin, forwardedFor) {
  return new Promise((resolve, reject) => {
    const socket = createClient(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { Origin: origin, 'X-Forwarded-For': forwardedFor },
    });
    sockets.push(socket);
    const timer = setTimeout(() => reject(new Error('connect timeout')), 5_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function ack(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(5_000).emit(event, payload, (error, result) =>
      error ? reject(error) : resolve(result),
    );
  });
}

test('production rejects a non-allowlisted Socket.IO origin', async () => {
  await assert.rejects(
    connect('https://evil.example', '198.51.100.10'),
    /origin_not_allowed|websocket error|xhr poll error/i,
  );
});

test('production metadata is derived from the handshake origin configuration', {
  skip: clientBuilt ? false : 'run `npm run build` to exercise SPA metadata',
}, async () => {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, new RegExp(`<link rel="canonical" href="${url.replaceAll('.', '\\.')}/"`));
  assert.doesNotMatch(html, /__PUBLIC_ORIGIN__/);
});

test('create limit uses the trusted right-most forwarded address', async () => {
  const results = [];
  for (let index = 0; index <= CREATE_LIMIT; index += 1) {
    // Rotating the left-most hop must not rotate the rate-limit identity: the
    // trusted right-most address is the same throughout.
    const socket = await connect(url, `203.0.113.${index + 1}, 198.51.100.20`);
    results.push(await ack(socket, 'room:create', { language: 'en' }));
  }
  assert.equal(results.slice(0, CREATE_LIMIT).every((result) => result.ok), true);
  assert.deepEqual(results[CREATE_LIMIT], { ok: false, error: 'rate_limited' });
});

test('one socket cannot remain authorized as two room identities', async () => {
  const firstHost = await connect(url, '198.51.100.30');
  let firstState;
  firstHost.on('room:state', (state) => { firstState = state; });
  const firstRoom = await ack(firstHost, 'room:create', { language: 'en' });
  assert.equal(firstRoom.ok, true);

  const player = await connect(url, '198.51.100.31');
  const joined = await ack(player, 'room:join', {
    code: firstRoom.data.code,
    name: 'Mover',
    avatar: 'fox',
  });
  assert.equal(joined.ok, true);

  const secondRoom = await ack(player, 'room:create', { language: 'en' });
  assert.equal(secondRoom.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(firstState.players.some((entry) => entry.id === joined.data.playerId), false);

  const oldRoomAction = await ack(player, 'room:join', {
    code: firstRoom.data.code,
    name: 'Mover Again',
    avatar: 'cat',
  });
  assert.equal(oldRoomAction.ok, true);
  const staleSecondSession = await ack(player, 'room:rejoin', {
    code: secondRoom.data.code,
    resumeToken: secondRoom.data.resumeToken,
  });
  assert.equal(staleSecondSession.ok, false);
});
