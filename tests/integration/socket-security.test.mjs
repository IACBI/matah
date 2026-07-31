import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as createClient } from 'socket.io-client';

import { startServer, stopServer } from '../../server/src/index.ts';

let baseUrl;
const liveSockets = new Set();

before(async () => {
  const port = await startServer(0);
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  for (const socket of liveSockets) socket.disconnect();
  await stopServer();
});

async function connect() {
  const socket = createClient(baseUrl, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  liveSockets.add(socket);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timeout')), 5_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return socket;
}

function ack(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} acknowledgement timeout`)), 5_000);
    const callback = (result) => {
      clearTimeout(timer);
      resolve(result);
    };
    if (payload === undefined) socket.emit(event, callback);
    else socket.emit(event, payload, callback);
  });
}

function once(socket, event, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} event timeout`)), timeoutMs);
    socket.once(event, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

async function createRoomWithPlayers(count = 3) {
  const host = await connect();
  let state;
  host.on('room:state', (next) => { state = next; });
  const created = await ack(host, 'room:create', { language: 'en' });
  assert.equal(created.ok, true);

  const members = [];
  for (let index = 0; index < count; index += 1) {
    const socket = await connect();
    const joined = await ack(socket, 'room:join', {
      code: created.data.code,
      name: `Player ${index + 1}`,
      avatar: 'fox',
    });
    assert.equal(joined.ok, true);
    members.push({ socket, session: joined.data });
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(state.players.length, count);
  return { host, hostSession: created.data, members, get state() { return state; } };
}

test('public player IDs cannot resume sessions and tokens rotate once', async () => {
  const room = await createRoomWithPlayers();
  const original = room.members[0];
  const replacement = await connect();
  const replacedEvent = once(original.socket, 'room:session-replaced');

  const resumed = await ack(replacement, 'room:rejoin', {
    code: room.hostSession.code,
    resumeToken: original.session.resumeToken,
  });
  assert.equal(resumed.ok, true);
  assert.notEqual(resumed.data.resumeToken, original.session.resumeToken);
  await replacedEvent;

  const attacker = await connect();
  const publicIdAttempt = await ack(attacker, 'room:rejoin', {
    code: room.hostSession.code,
    resumeToken: original.session.playerId,
  });
  assert.deepEqual(publicIdAttempt, { ok: false, error: 'session_not_found' });

  const replayAttempt = await ack(attacker, 'room:rejoin', {
    code: room.hostSession.code,
    resumeToken: original.session.resumeToken,
  });
  assert.deepEqual(replayAttempt, { ok: false, error: 'session_not_found' });

  const oldSocketAction = await ack(original.socket, 'room:leave');
  assert.deepEqual(oldSocketAction, { ok: false, error: 'no_room' });
});

test('leave removes membership immediately and frees the seat', async () => {
  const room = await createRoomWithPlayers();
  const leaving = room.members[0];
  const stateAfterLeave = once(room.host, 'room:state');
  assert.deepEqual(await ack(leaving.socket, 'room:leave'), { ok: true, data: null });
  const leftState = await stateAfterLeave;
  assert.equal(leftState.players.some((p) => p.id === leaving.session.playerId), false);

  const replacement = await connect();
  const joined = await ack(replacement, 'room:join', {
    code: room.hostSession.code,
    name: 'Replacement',
    avatar: 'cat',
  });
  assert.equal(joined.ok, true);
  assert.equal(joined.data.isAudience, false);
});

test('phase guards reject duplicate controls and trivia payload coercion', async () => {
  const room = await createRoomWithPlayers();
  const lobbyPhaseId = room.state.phaseId;
  const started = await ack(room.host, 'game:start', {
    gameType: 'trivia',
    rounds: 3,
    phaseId: lobbyPhaseId,
  });
  assert.deepEqual(started, { ok: true, data: null });

  const duplicate = await ack(room.host, 'game:start', {
    gameType: 'trivia',
    rounds: 3,
    phaseId: lobbyPhaseId,
  });
  assert.equal(duplicate.ok, false);
  assert.ok(['stale_phase', 'invalid_phase'].includes(duplicate.error));

  const question = room.state.trivia.question;
  const badString = await ack(room.members[0].socket, 'trivia:answer', {
    questionId: question.id,
    optionIndex: '0',
  });
  const badNull = await ack(room.members[0].socket, 'trivia:answer', {
    questionId: question.id,
    optionIndex: null,
  });
  const badBoolean = await ack(room.members[0].socket, 'trivia:answer', {
    questionId: question.id,
    optionIndex: true,
  });
  assert.deepEqual(badString, { ok: false, error: 'submit_failed' });
  assert.deepEqual(badNull, { ok: false, error: 'submit_failed' });
  assert.deepEqual(badBoolean, { ok: false, error: 'submit_failed' });

  const valid = await ack(room.members[0].socket, 'trivia:answer', {
    questionId: question.id,
    optionIndex: 0,
  });
  assert.deepEqual(valid, { ok: true, data: null });

  const ended = await ack(room.host, 'game:end', { phaseId: room.state.phaseId });
  assert.deepEqual(ended, { ok: true, data: null });
  const rematched = await ack(room.host, 'game:rematch', { phaseId: room.state.phaseId });
  assert.deepEqual(rematched, { ok: true, data: null });
  assert.notEqual(
    room.state.trivia.question.text,
    question.text,
    'rematch should avoid recently used questions while the pool allows it',
  );
});
