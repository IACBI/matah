import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { io as createClient } from 'socket.io-client';

const ROOM_COUNT = 25;
const PLAYERS_PER_ROOM = 3;
const DURATION_MS = Number(process.env.LOAD_DURATION_MS ?? 60_000);

function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
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
const { activeRoomCount, startServer, stopServer } = await import('../server/src/index.ts');

const sockets = [];
const latencies = [];

function connect(testIp) {
  return new Promise((resolve, reject) => {
    const socket = createClient(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { Origin: url, 'X-Forwarded-For': testIp },
    });
    sockets.push(socket);
    const timer = setTimeout(() => reject(new Error('load connection timeout')), 5_000);
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
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} ack timeout`)), 5_000);
    const callback = (result) => {
      clearTimeout(timer);
      latencies.push(performance.now() - startedAt);
      resolve(result);
    };
    if (payload === undefined) socket.emit(event, callback);
    else socket.emit(event, payload, callback);
  });
}

async function createLoadedRoom(index) {
  const testIp = `198.51.100.${index + 1}`;
  const host = await connect(testIp);
  let state = null;
  host.on('room:state', (next) => { state = next; });
  const created = await ack(host, 'room:create', { language: 'en' });
  assert.equal(created.ok, true);
  const players = [];
  for (let playerIndex = 0; playerIndex < PLAYERS_PER_ROOM; playerIndex += 1) {
    const socket = await connect(testIp);
    const joined = await ack(socket, 'room:join', {
      code: created.data.code,
      name: `R${index + 1}P${playerIndex + 1}`,
      avatar: 'fox',
    });
    assert.equal(joined.ok, true);
    players.push(socket);
  }
  while (!state || state.players.length !== PLAYERS_PER_ROOM) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const started = await ack(host, 'game:start', {
    gameType: 'trivia',
    rounds: 3,
    phaseId: state.phaseId,
  });
  assert.equal(started.ok, true);
  return { host, players, getState: () => state, handledQuestion: null, handledPhase: null };
}

await startServer(port);
try {
  const rooms = [];
  for (let index = 0; index < ROOM_COUNT; index += 1) {
    rooms.push(await createLoadedRoom(index));
  }
  assert.equal(sockets.length, 100);
  assert.equal(activeRoomCount(), ROOM_COUNT);

  const deadline = Date.now() + DURATION_MS;
  while (Date.now() < deadline) {
    await Promise.all(rooms.map(async (room) => {
      const state = room.getState();
      if (state?.phase === 'answering' && state.trivia?.question?.id !== room.handledQuestion) {
        room.handledQuestion = state.trivia.question.id;
        await Promise.all(room.players.map(async (socket, index) => {
          const result = await ack(socket, 'trivia:answer', {
            questionId: state.trivia.question.id,
            optionIndex: index,
          });
          assert.equal(result.ok, true, `trivia answer rejected: ${result.error ?? 'unknown'}`);
        }));
      } else if (state?.phase === 'results' && state.phaseId !== room.handledPhase) {
        room.handledPhase = state.phaseId;
        const result = await ack(room.host, 'game:next', { phaseId: state.phaseId });
        assert.equal(result.ok, true);
      } else if ((state?.phase === 'scoreboard' || state?.phase === 'gameover') && state.phaseId !== room.handledPhase) {
        room.handledPhase = state.phaseId;
        const result = await ack(room.host, 'game:rematch', { phaseId: state.phaseId });
        assert.equal(result.ok, true);
      }
    }));
    // Keep the synthetic clients below the documented 20 actions/second
    // gameplay budget; this suite measures sustained service latency, not
    // whether deliberately rate-limited floods can bypass the limiter.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  for (const room of rooms) {
    for (const player of room.players) {
      assert.deepEqual(await ack(player, 'room:leave'), { ok: true, data: null });
    }
    assert.deepEqual(await ack(room.host, 'room:leave'), { ok: true, data: null });
  }
  assert.equal(activeRoomCount(), 0, 'all rooms should be reclaimed after explicit leave');

  const sorted = latencies.toSorted((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  assert.ok(p95 < 1_000, `gameplay acknowledgement p95 was ${p95.toFixed(1)}ms`);
  console.log(`Load test passed: 25 rooms, 100 sockets, ${latencies.length} acks, p95=${p95.toFixed(1)}ms.`);
} finally {
  for (const socket of sockets) socket.disconnect();
  await stopServer();
}
