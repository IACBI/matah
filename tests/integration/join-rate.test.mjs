import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { clients } from '../helpers/socket.mjs';
import { probePort } from '../helpers/port.mjs';

// Production with one trusted proxy, so each client's identity is the address
// it puts in X-Forwarded-For. Read at module load, so this suite owns its process.
const ROOM_LIMIT = 3;
const ROOM_IP_LIMIT = 2;
const port = await probePort();
const url = `http://127.0.0.1:${port}`;
process.env.NODE_ENV = 'production';
process.env.PUBLIC_ORIGIN = url;
process.env.MATAH_TRUST_PROXY_HOPS = '1';
process.env.MATAH_RL_CREATE = '500';
process.env.MATAH_RL_JOIN = '500';
process.env.MATAH_RL_JOIN_ROOM = String(ROOM_LIMIT);
process.env.MATAH_RL_JOIN_ROOM_IP = String(ROOM_IP_LIMIT);
const { startServer, stopServer } = await import('../../server/src/index.ts');

const { connect: openSocket, ack, disconnectAll } = clients(() => url);
const connect = (address) => openSocket({ Origin: url, 'X-Forwarded-For': address });

before(() => startServer(port));
after(async () => {
  disconnectAll();
  await stopServer();
});

async function openRoom() {
  const host = await connect('198.51.100.1');
  const created = await ack(host, 'room:create', { language: 'en' });
  assert.equal(created.ok, true);
  return created.data.code;
}

test('joins refused for an empty name do not spend the room-wide budget', async () => {
  const code = await openRoom();
  const attacker = await connect('198.51.100.2');
  // Each join costs the socket three tokens of its 20-token bucket, so this stays under it.
  for (let index = 0; index < ROOM_LIMIT * 2; index += 1) {
    assert.deepEqual(
      await ack(attacker, 'room:join', { code, name: '   ', avatar: 'fox' }),
      { ok: false, error: 'name_required' },
    );
  }

  const legitimate = await connect('198.51.100.3');
  const joined = await ack(legitimate, 'room:join', { code, name: 'Ayse', avatar: 'cat' });
  assert.equal(joined.ok, true);
});

test('one source cycling valid joins runs out of its own share before the room budget', async () => {
  const code = await openRoom();
  const cycler = await connect('198.51.100.4');
  const results = [];
  for (let index = 0; index < ROOM_IP_LIMIT + 2; index += 1) {
    results.push(await ack(cycler, 'room:join', { code, name: `Cycle ${index}`, avatar: 'fox' }));
  }
  assert.equal(results.slice(0, ROOM_IP_LIMIT).every((result) => result.ok), true);
  assert.deepEqual(results[ROOM_IP_LIMIT], { ok: false, error: 'rate_limited' });

  // The room-wide budget still has room for the rest of the table.
  const legitimate = await connect('198.51.100.5');
  const joined = await ack(legitimate, 'room:join', { code, name: 'Mehmet', avatar: 'owl' });
  assert.equal(joined.ok, true);
});
