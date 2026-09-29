import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { clients } from '../helpers/socket.mjs';
import { probePort } from '../helpers/port.mjs';

// No proxy at all: the process faces clients directly, so X-Forwarded-For is
// whatever the client typed and must not choose its rate-limit identity.
const CREATE_LIMIT = 3;
const port = await probePort();
const url = `http://127.0.0.1:${port}`;
process.env.NODE_ENV = 'production';
process.env.PUBLIC_ORIGIN = url;
process.env.MATAH_TRUST_PROXY_HOPS = '0';
process.env.MATAH_RL_CREATE = String(CREATE_LIMIT);
process.env.MATAH_RL_ROOMS_PER_IP = '500';
const { startServer, stopServer } = await import('../../server/src/index.ts');

const { connect: openSocket, ack, disconnectAll } = clients(() => url);
const connect = (forwardedFor) =>
  openSocket({ Origin: url, 'X-Forwarded-For': forwardedFor });

before(() => startServer(port));
after(async () => {
  disconnectAll();
  await stopServer();
});

test('a forged X-Forwarded-For cannot buy a fresh budget when no proxy is trusted', async () => {
  const results = [];
  for (let index = 0; index <= CREATE_LIMIT; index += 1) {
    const socket = await connect(`198.51.100.${index + 1}`);
    results.push(await ack(socket, 'room:create', { language: 'en' }));
  }
  assert.equal(results.slice(0, CREATE_LIMIT).every((result) => result.ok), true);
  assert.deepEqual(results[CREATE_LIMIT], { ok: false, error: 'rate_limited' });
});

test('without a stats token there is no stats endpoint at all', async () => {
  const response = await fetch(`${url}/stats`);
  assert.notEqual(response.status, 401, 'nothing is guarding a route that does not exist');
  assert.doesNotMatch(response.headers.get('content-type') ?? '', /json/);
});
