import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer as createProbe } from 'node:net';
import { io as createClient } from 'socket.io-client';

function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = createProbe();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

const port = await availablePort();
const url = `http://127.0.0.1:${port}`;
process.env.NODE_ENV = 'production';
process.env.PUBLIC_ORIGIN = url;
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

test('production metadata is derived from the handshake origin configuration', async () => {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, new RegExp(`<link rel="canonical" href="${url.replaceAll('.', '\\.')}/"`));
  assert.doesNotMatch(html, /__PUBLIC_ORIGIN__/);
});

test('create limit uses the trusted right-most forwarded address', async () => {
  const results = [];
  for (let index = 0; index < 6; index += 1) {
    const socket = await connect(url, `203.0.113.${index + 1}, 198.51.100.20`);
    results.push(await ack(socket, 'room:create', { language: 'en' }));
  }
  assert.equal(results.slice(0, 5).every((result) => result.ok), true);
  assert.deepEqual(results[5], { ok: false, error: 'rate_limited' });
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
