import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';

import { clients } from '../helpers/socket.mjs';
import { probePort } from '../helpers/port.mjs';

// Two proxies in front (a CDN and then the platform's router): each appends the
// address it received the connection from, so the visitor is the second entry
// from the right. Read once at module load, like PUBLIC_ORIGIN, so this suite
// owns its own process.
const CREATE_LIMIT = 3;
const port = await probePort();
const url = `http://127.0.0.1:${port}`;
process.env.NODE_ENV = 'production';
process.env.PUBLIC_ORIGIN = url;
process.env.MATAH_TRUST_PROXY_HOPS = '2';
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

test('with two trusted proxies the visitor is the second address from the right', async () => {
  const results = [];
  for (let index = 0; index <= CREATE_LIMIT; index += 1) {
    // The left-most entry is the client's own forgery and the right-most is the
    // outer proxy; neither may change the identity the limit is charged to.
    const socket = await connect(`forged-${index}, 203.0.113.9, 10.0.0.${index + 1}`);
    results.push(await ack(socket, 'room:create', { language: 'en' }));
  }
  assert.equal(results.slice(0, CREATE_LIMIT).every((result) => result.ok), true);
  assert.deepEqual(results[CREATE_LIMIT], { ok: false, error: 'rate_limited' });
});

test('another visitor behind the same outer proxy keeps a budget of their own', async () => {
  const socket = await connect('forged, 203.0.113.77, 10.0.0.1');
  assert.equal((await ack(socket, 'room:create', { language: 'en' })).ok, true);
});

test('a malformed proxy count stops the boot instead of guessing', () => {
  const entry = pathToFileURL(
    path.resolve(fileURLToPath(import.meta.url), '../../../server/src/index.ts'),
  ).href;
  for (const bad of ['two', '-1', '1.5', '11']) {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '-e', `await import(${JSON.stringify(entry)})`],
      {
        encoding: 'utf8',
        env: { ...process.env, MATAH_TRUST_PROXY_HOPS: bad },
        timeout: 30_000,
      },
    );
    assert.notEqual(result.status, 0, `${bad} should not boot`);
    assert.match(result.stderr, /MATAH_TRUST_PROXY_HOPS must be a whole number/);
  }
});
