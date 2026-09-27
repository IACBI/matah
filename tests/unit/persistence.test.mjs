import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  encodeCommand,
  FileSnapshotStore,
  parseResp,
  RedisSnapshotStore,
  storeFromEnv,
} from '../../server/src/persistence.ts';

// Set to a disposable Redis (CI runs one as a service container) to exercise
// the Redis store against the real server rather than a stand-in.
const REDIS_URL = process.env.MATAH_TEST_REDIS_URL;

test('RESP commands are encoded as arrays of byte-counted bulk strings', () => {
  assert.equal(
    encodeCommand(['SET', 'k', 'çay']).toString('utf8'),
    '*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$4\r\nçay\r\n',
    'lengths count bytes, not characters',
  );
});

test('RESP replies parse whole, and wait when a reply is still arriving', () => {
  assert.deepEqual(parseResp(Buffer.from('+OK\r\n')), { value: 'OK', next: 5 });
  assert.deepEqual(parseResp(Buffer.from(':42\r\n')), { value: 42, next: 5 });
  assert.deepEqual(parseResp(Buffer.from('$-1\r\n')), { value: null, next: 5 });
  const bulk = Buffer.from('$4\r\nçay\r\n');
  assert.deepEqual(parseResp(bulk), { value: 'çay', next: bulk.length });
  assert.equal(parseResp(Buffer.from('$4\r\nça')), undefined, 'partial bulk string');
  assert.equal(parseResp(Buffer.from('+OK')), undefined, 'partial line');
  assert.deepEqual(parseResp(Buffer.from('*2\r\n+a\r\n:1\r\n')).value, ['a', 1]);
  const error = parseResp(Buffer.from('-WRONGPASS nope\r\n')).value;
  assert.ok(error instanceof Error);
  assert.equal(error.message, 'WRONGPASS nope');
  assert.throws(() => parseResp(Buffer.from('?x\r\n')), /unexpected RESP type/);
});

test('the file store round-trips and replaces the snapshot atomically', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'matah-snapshot-'));
  try {
    const file = path.join(dir, 'nested', 'rooms.json');
    const store = new FileSnapshotStore(file);
    assert.equal(await store.load(), null, 'no snapshot yet');
    await store.save('{"first":true}');
    await store.save('{"second":true}');
    assert.equal(await store.load(), '{"second":true}');
    assert.deepEqual(await readdir(path.dirname(file)), ['rooms.json'], 'no temp files left');
    assert.equal(await readFile(file, 'utf8'), '{"second":true}');
    assert.match(store.describe(), /rooms\.json/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the environment picks Redis over a file, and nothing when unset', () => {
  assert.equal(storeFromEnv({}), null);
  assert.ok(storeFromEnv({ MATAH_SNAPSHOT_FILE: 'x.json' }) instanceof FileSnapshotStore);
  const redis = storeFromEnv({
    MATAH_SNAPSHOT_FILE: 'x.json',
    MATAH_REDIS_URL: 'redis://user:hunter2@cache.internal:6380/2',
  });
  assert.ok(redis instanceof RedisSnapshotStore);
  assert.doesNotMatch(redis.describe(), /hunter2|user/, 'credentials never reach a log line');
  assert.throws(() => new RedisSnapshotStore('http://cache:6379'), /redis:\/\//);
});

test('an unreachable Redis fails fast instead of hanging startup', async () => {
  // Port 9 (discard) is closed on loopback everywhere this runs.
  const store = new RedisSnapshotStore('redis://127.0.0.1:9', 'k', 60, 2_000);
  await assert.rejects(store.load());
});

test('the Redis store round-trips against a real server', { skip: !REDIS_URL }, async () => {
  const key = `matah:test:${process.pid}:${Date.now()}`;
  const store = new RedisSnapshotStore(REDIS_URL, key, 60);
  assert.equal(await store.load(), null);
  // Large and multi-byte, so replies arrive in several TCP chunks.
  const payload = JSON.stringify({ rooms: Array.from({ length: 2_000 }, (_, i) => `oda-${i}-çğüşö-玩家`) });
  await store.save(payload);
  assert.equal(await store.load(), payload);
  await store.save('{}');
  assert.equal(await store.load(), '{}');
});

test('a wrong Redis password is reported without echoing it', { skip: !REDIS_URL }, async () => {
  const url = new URL(REDIS_URL);
  url.password = 'definitely-wrong-password';
  const store = new RedisSnapshotStore(url.toString(), 'k', 60);
  await assert.rejects(store.load(), (error) => {
    assert.match(error.message, /Redis error/);
    assert.doesNotMatch(error.message, /definitely-wrong-password/);
    return true;
  });
});
