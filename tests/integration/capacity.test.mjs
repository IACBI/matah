import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { clients } from '../helpers/socket.mjs';

// Both ceilings here are about accumulation rather than rate, so they are
// pinned far below their shipped sizes: driving the real 500-room registry or
// 1,000-socket ceiling from a test would take minutes and prove nothing extra.
const ROOMS_PER_IP = 3;
const MAX_CONNECTIONS = 12;
process.env.MATAH_RL_CREATE = '500';
process.env.MATAH_RL_ROOMS_PER_IP = String(ROOMS_PER_IP);
process.env.MATAH_RL_MAX_CONNECTIONS = String(MAX_CONNECTIONS);
const { startServer, stopServer } = await import('../../server/src/index.ts');

let baseUrl;
const { connect, ack, disconnectAll } = clients(() => baseUrl);

before(async () => {
  const port = await startServer(0);
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  disconnectAll();
  await stopServer();
});

test('one address may not pin more than its share of the registry', async () => {
  // One socket holds one room, so a hoarder needs a socket per room.
  const held = [];
  for (let index = 0; index < ROOMS_PER_IP; index += 1) {
    const socket = await connect();
    held.push(socket);
    assert.equal((await ack(socket, 'room:create', { language: 'en' })).ok, true);
  }

  const extra = await connect();
  assert.deepEqual(
    await ack(extra, 'room:create', { language: 'en' }),
    { ok: false, error: 'rate_limited' },
    'the create rate limit is generous here; the quota is what must refuse',
  );

  // Releasing a room hands the slot back rather than leaking it. The refused
  // create above already cost `extra` most of its per-socket budget, so the
  // reclaim comes from a fresh socket at the same address.
  assert.equal((await ack(held[0], 'room:leave')).ok, true);
  const reclaimer = await connect();
  assert.equal((await ack(reclaimer, 'room:create', { language: 'en' })).ok, true);

  for (const socket of [...held.slice(1), reclaimer]) {
    assert.equal((await ack(socket, 'room:leave')).ok, true);
  }
});

test('a global ceiling sheds new sessions instead of accumulating them', async () => {
  const established = await connect();
  assert.equal((await ack(established, 'room:create', { language: 'en' })).ok, true);

  let refused = null;
  for (let attempt = 0; attempt <= MAX_CONNECTIONS && !refused; attempt += 1) {
    try {
      await connect();
    } catch (error) {
      refused = error;
    }
  }
  assert.ok(refused, 'the ceiling has to refuse a handshake eventually');

  // A session that already exists is untouched: its frames carry a sid and
  // never reach the admission hook, so games in progress keep playing.
  assert.equal((await ack(established, 'room:leave')).ok, true);
});
