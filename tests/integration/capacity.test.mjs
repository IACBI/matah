import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { clients } from '../helpers/socket.mjs';
import { probePort } from '../helpers/port.mjs';

// These ceilings are about accumulation rather than rate, so they are pinned
// far below their shipped sizes: driving the real 500-room registry or
// 5,000-socket ceiling from a test would take minutes and prove nothing extra.
const ROOMS_PER_IP = 3;
const CONNECTIONS_PER_IP = 6;
const MAX_CONNECTIONS = 20;

// Production mode, so clientAddress() reads the forwarded address and each
// test can hold an identity of its own — every socket here shares 127.0.0.1.
// PUBLIC_ORIGIN is read once at module load and must match the listening port,
// so this suite cannot retry onto a different port the way the others can.
const port = await probePort();
const url = `http://127.0.0.1:${port}`;
process.env.NODE_ENV = 'production';
process.env.PUBLIC_ORIGIN = url;
process.env.MATAH_RL_CREATE = '500';
process.env.MATAH_RL_ROOMS_PER_IP = String(ROOMS_PER_IP);
process.env.MATAH_RL_CONNECTIONS_PER_IP = String(CONNECTIONS_PER_IP);
process.env.MATAH_RL_MAX_CONNECTIONS = String(MAX_CONNECTIONS);
const { startServer, stopServer } = await import('../../server/src/index.ts');

const { connect: openSocket, ack, disconnectAll } = clients(() => url);
const connect = (identity) =>
  openSocket({ Origin: url, 'X-Forwarded-For': identity });

before(() => startServer(port));
after(async () => {
  disconnectAll();
  await stopServer();
});

test('one address may not pin more than its share of the registry', async () => {
  // One socket holds one room, so a hoarder needs a socket per room.
  const held = [];
  for (let index = 0; index < ROOMS_PER_IP; index += 1) {
    const socket = await connect('203.0.113.10');
    held.push(socket);
    assert.equal((await ack(socket, 'room:create', { language: 'en' })).ok, true);
  }

  const extra = await connect('203.0.113.10');
  assert.deepEqual(
    await ack(extra, 'room:create', { language: 'en' }),
    { ok: false, error: 'rate_limited' },
    'the create rate limit is generous here; the quota is what must refuse',
  );

  // Releasing a room hands the slot back rather than leaking it. The refused
  // create above already cost `extra` most of its per-socket budget, so the
  // reclaim comes from a fresh socket at the same address.
  assert.equal((await ack(held[0], 'room:leave')).ok, true);
  const reclaimer = await connect('203.0.113.10');
  assert.equal((await ack(reclaimer, 'room:create', { language: 'en' })).ok, true);

  for (const socket of [...held.slice(1), reclaimer]) {
    assert.equal((await ack(socket, 'room:leave')).ok, true);
  }
});

test('one address may not hold more than its share of the live sessions', async () => {
  for (let index = 0; index < CONNECTIONS_PER_IP; index += 1) {
    await connect('203.0.113.20');
  }
  await assert.rejects(
    connect('203.0.113.20'),
    'the share is what stops one client from reaching the global ceiling alone',
  );

  // Another address is unaffected, which is what separates this from the
  // global ceiling: the server is nowhere near full.
  const neighbour = await connect('203.0.113.21');
  assert.equal((await ack(neighbour, 'room:create', { language: 'en' })).ok, true);
  assert.equal((await ack(neighbour, 'room:leave')).ok, true);
});

test('a global ceiling sheds new sessions instead of accumulating them', async () => {
  const established = await connect('203.0.113.30');
  assert.equal((await ack(established, 'room:create', { language: 'en' })).ok, true);

  // Rotate addresses well inside the per-address share, so the refusal below
  // can only be the global ceiling.
  let opened = 0;
  let refused = null;
  for (let attempt = 0; attempt < MAX_CONNECTIONS * 2 && !refused; attempt += 1) {
    try {
      await connect(`203.0.113.${100 + Math.floor(attempt / (CONNECTIONS_PER_IP - 1))}`);
      opened += 1;
    } catch (error) {
      refused = error;
    }
  }
  assert.ok(refused, 'the ceiling has to refuse a handshake eventually');
  assert.ok(
    opened > CONNECTIONS_PER_IP,
    `no single address reached its share, so ${opened} admitted sockets must be the global ceiling`,
  );

  // A session that already exists is untouched: its frames carry a sid and
  // never reach the admission hook, so games in progress keep playing.
  assert.equal((await ack(established, 'room:leave')).ok, true);
});
