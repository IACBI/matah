import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { clients } from '../helpers/socket.mjs';

// See room-flows.test.mjs: every socket shares one address, so the per-address
// budget would throttle setup. origin-rate.test.mjs covers the limits.
process.env.MATAH_RL_CREATE = '500';
process.env.MATAH_RL_ACTION_BURST = '5000';
const { startServer, stopServer } = await import('../../server/src/index.ts');

let baseUrl;
const { connect, ack, once, until, createRoomWithPlayers, disconnectAll } =
  clients(() => baseUrl);

before(async () => {
  const port = await startServer(0);
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  disconnectAll();
  await stopServer();
});

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

test('a stand-in controller may run the game but never remove anyone', async () => {
  const room = await createRoomWithPlayers(3);
  const [first, second] = room.members;
  const watcher = first.socket;
  // The host socket is about to drop, so follow the room from a player.
  let live;
  watcher.on('room:state', (state) => { live = state; });

  // Losing the host hands control to the first player who joined, but only
  // after the failover delay, and never the ability to kick.
  const elected = until(
    watcher,
    (s) => s.controllerPlayerId === first.session.playerId,
    'controller election',
    20_000,
  );
  room.host.disconnect();
  assert.equal((await elected).hostConnected, false);

  assert.deepEqual(
    await ack(watcher, 'player:kick', {
      playerId: second.session.playerId,
      phaseId: live.phaseId,
    }),
    { ok: false, error: 'host_only' },
    'the first player to join must not be able to clear the room',
  );

  const playing = until(watcher, (s) => s.phase === 'answering', 'stand-in start');
  assert.deepEqual(
    await ack(watcher, 'game:start', {
      gameType: 'trivia',
      rounds: 3,
      phaseId: live.phaseId,
    }),
    { ok: true, data: null },
    'someone has to be able to keep the party going',
  );
  await playing;

  // A player who was not elected gains nothing from the failover.
  assert.deepEqual(
    await ack(second.socket, 'game:end', { phaseId: live.phaseId }),
    { ok: false, error: 'host_only' },
  );
});
