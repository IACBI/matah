import { test } from 'node:test';

import { gracefulRestart } from '../helpers/restart.mjs';

// Needs a disposable Redis (CI runs one as a service container); skipped
// without one rather than faked.
const REDIS_URL = process.env.MATAH_TEST_REDIS_URL;

process.env.MATAH_RL_CREATE = '500';
process.env.MATAH_RL_ACTION_BURST = '5000';
process.env.MATAH_RL_ROOMS_PER_IP = '500';
if (REDIS_URL) {
  process.env.MATAH_REDIS_URL = REDIS_URL;
  process.env.MATAH_SNAPSHOT_KEY = `matah:test:restart:${process.pid}:${Date.now()}`;
}
const server = await import('../../server/src/index.ts');

test('a graceful restart keeps a game in progress (Redis store)', { skip: !REDIS_URL }, async () => {
  await gracefulRestart(server);
});
