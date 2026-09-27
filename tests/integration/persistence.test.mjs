import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { gracefulRestart, playUntilMidRound, resumeAndFinishRound } from '../helpers/restart.mjs';
import { clients } from '../helpers/socket.mjs';

process.env.MATAH_RL_CREATE = '500';
process.env.MATAH_RL_ACTION_BURST = '5000';
process.env.MATAH_RL_ROOMS_PER_IP = '500';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = mkdtempSync(path.join(tmpdir(), 'matah-restart-'));
// The store is read once, when the server module loads.
const GRACEFUL_FILE = path.join(dir, 'graceful.json');
process.env.MATAH_SNAPSHOT_FILE = GRACEFUL_FILE;
const server = await import('../../server/src/index.ts');

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('a graceful restart keeps a game in progress (file store)', async () => {
  const game = await gracefulRestart(server);
  // Written again on the second shutdown; still hashes only.
  const saved = await readFile(GRACEFUL_FILE, 'utf8');
  assert.equal(JSON.parse(saved).rooms.length, 1);
  assert.ok(!saved.includes(game.room.hostSession.resumeToken), 'no raw tokens on disk');
});

/** Run the real entry point in its own process and wait for it to listen. */
function spawnServer(env) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 20_000);
    const onData = (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (${code}):\n${output}`));
    });
  });
  return { child, ready, output: () => output };
}

function kill(child) {
  return new Promise((resolve) => {
    // A signal-killed child reports signalCode, not exitCode.
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', resolve);
    // No chance to save: this is the crash, not the shutdown.
    child.kill('SIGKILL');
  });
}

test('a crashed server comes back from its last periodic save', async () => {
  const file = path.join(dir, 'crash.json');
  const env = { MATAH_SNAPSHOT_FILE: file, MATAH_SNAPSHOT_INTERVAL_MS: '1000' };
  const first = spawnServer(env);
  let second;
  let baseUrl = '';
  const io = clients(() => baseUrl);
  try {
    baseUrl = await first.ready;
    const game = await playUntilMidRound(io);
    // Wait for a periodic save that already holds the submitted answer.
    const deadline = Date.now() + 10_000;
    for (;;) {
      const raw = await readFile(file, 'utf8').catch(() => '');
      if (raw.includes('Written before the restart')) break;
      assert.ok(Date.now() < deadline, 'no periodic snapshot was written');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    io.disconnectAll();
    await kill(first.child);

    second = spawnServer(env);
    baseUrl = await second.ready;
    assert.match(second.output(), /Restored 1 room/);
    await resumeAndFinishRound(io, game);
  } finally {
    io.disconnectAll();
    await kill(first.child);
    if (second) await kill(second.child);
  }
});
