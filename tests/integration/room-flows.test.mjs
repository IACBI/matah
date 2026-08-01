import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { clients } from '../helpers/socket.mjs';

// Every socket here shares 127.0.0.1, so the per-address policies would
// throttle the suite itself before it finished setting up. Limits are covered
// by origin-rate.test.mjs; this file is about what happens inside a room. The
// per-socket reaction bucket is untouched, and one test relies on it.
process.env.MATAH_RL_CREATE = '500';
process.env.MATAH_RL_ACTION_BURST = '5000';
const { activeRoomCount, startServer, stopServer } = await import('../../server/src/index.ts');

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

test('kicking removes a player, notifies them, and costs one revision', async () => {
  const room = await createRoomWithPlayers(3);
  const target = room.members[2];
  const notified = once(target.socket, 'room:kicked');
  const before = room.state.phaseId;

  const rejected = await ack(room.members[0].socket, 'player:kick', {
    playerId: target.session.playerId,
    phaseId: room.state.phaseId,
  });
  assert.deepEqual(rejected, { ok: false, error: 'host_only' }, 'players cannot kick');

  const gone = until(room.host, (s) => s.players.length === 2, 'kicked roster');
  const kicked = await ack(room.host, 'player:kick', {
    playerId: target.session.playerId,
    phaseId: room.state.phaseId,
  });
  assert.equal(kicked.ok, true);
  await notified;
  const after = await gone;
  assert.equal(after.players.some((p) => p.id === target.session.playerId), false);
  assert.equal(after.phaseId - before, 1, 'one action, one revision');

  // The kicked session must not be resumable.
  const ghost = await connect();
  const resumed = await ack(ghost, 'room:rejoin', {
    code: room.hostSession.code,
    resumeToken: target.session.resumeToken,
  });
  assert.deepEqual(resumed, { ok: false, error: 'session_not_found' });
});

test('ending a game early jumps to the scoreboard and clears the engine view', async () => {
  const room = await createRoomWithPlayers(3);
  const playing = until(room.host, (s) => s.phase === 'answering', 'game start');
  assert.equal(
    (await ack(room.host, 'game:start', { gameType: 'quiplash', rounds: 3, phaseId: room.state.phaseId })).ok,
    true,
  );
  const started = await playing;

  const ending = until(room.host, (s) => s.phase === 'scoreboard', 'scoreboard');
  assert.equal((await ack(room.host, 'game:end', { phaseId: started.phaseId })).ok, true);
  const scoreboard = await ending;
  assert.equal(scoreboard.quiplash, undefined, 'abandoned mid-round results must not linger');
  assert.equal(scoreboard.totalRounds, 3, 'the header keeps its counters');
});

test('changing the content language is refused once a game is running', async () => {
  const room = await createRoomWithPlayers(3);
  const switched = until(room.host, (s) => s.language === 'de', 'language change');
  assert.equal(
    (await ack(room.host, 'room:setLanguage', { language: 'de', phaseId: room.state.phaseId })).ok,
    true,
  );
  const inGerman = await switched;

  assert.deepEqual(
    await ack(room.host, 'room:setLanguage', { language: 'zz', phaseId: inGerman.phaseId }),
    { ok: false, error: 'invalid_language' },
  );

  const playing = until(room.host, (s) => s.phase === 'answering', 'game start');
  await ack(room.host, 'game:start', { gameType: 'trivia', rounds: 3, phaseId: inGerman.phaseId });
  const started = await playing;
  assert.deepEqual(
    await ack(room.host, 'room:setLanguage', { language: 'fr', phaseId: started.phaseId }),
    { ok: false, error: 'invalid_phase' },
  );
});

test('players who join after the start become audience and are seated on restart', async () => {
  const room = await createRoomWithPlayers(3);
  const playing = until(room.host, (s) => s.phase === 'answering', 'game start');
  await ack(room.host, 'game:start', { gameType: 'trivia', rounds: 3, phaseId: room.state.phaseId });
  const started = await playing;

  const spectatorSeat = until(room.host, (s) => s.audience.length === 1, 'audience');
  const latecomer = await connect();
  const joined = await ack(latecomer, 'room:join', {
    code: room.hostSession.code,
    name: 'Latecomer',
    avatar: 'cat',
  });
  assert.equal(joined.ok, true);
  assert.equal(joined.data.isAudience, true);
  const watching = await spectatorSeat;
  assert.equal(watching.audience[0].hasVoted, false, 'audience vote progress is broadcast');

  const backToLobby = until(room.host, (s) => s.phase === 'lobby', 'lobby');
  await ack(room.host, 'game:restart', { phaseId: started.phaseId });
  const lobby = await backToLobby;
  assert.equal(lobby.players.length, 4, 'a spectator should play the next game');
  assert.equal(lobby.audience.length, 0);
});

test('reactions are validated and rate limited per socket', async () => {
  const room = await createRoomWithPlayers(3);
  const playing = until(room.host, (s) => s.phase === 'answering', 'game start');
  await ack(room.host, 'game:start', { gameType: 'trivia', rounds: 3, phaseId: room.state.phaseId });
  await playing;

  const player = room.members[0].socket;
  const seen = once(room.host, 'room:reaction');
  assert.equal((await ack(player, 'reaction:send', { emoji: 'laugh' })).ok, true);
  assert.equal((await seen).emoji, 'laugh');

  assert.deepEqual(
    await ack(player, 'reaction:send', { emoji: '../etc/passwd' }),
    { ok: false, error: 'invalid_reaction' },
  );

  // The per-socket reaction bucket holds three; spend it and confirm it closes.
  const burst = [];
  for (let index = 0; index < 6; index += 1) {
    burst.push(await ack(player, 'reaction:send', { emoji: 'fire' }));
  }
  assert.ok(
    burst.some((result) => !result.ok && result.error === 'rate_limited'),
    'a reaction spammer must be throttled',
  );
});

test('a room is reclaimed as soon as its last member leaves', async () => {
  const before = activeRoomCount();
  const room = await createRoomWithPlayers(1);
  assert.equal(activeRoomCount(), before + 1);

  for (const member of room.members) {
    assert.deepEqual(await ack(member.socket, 'room:leave'), { ok: true, data: null });
  }
  assert.deepEqual(await ack(room.host, 'room:leave'), { ok: true, data: null });
  assert.equal(activeRoomCount(), before, 'an empty room must not wait for the sweep');
});

test('a game cannot start below the player floor', async () => {
  const room = await createRoomWithPlayers(2);
  assert.deepEqual(
    await ack(room.host, 'game:start', { gameType: 'trivia', rounds: 3, phaseId: room.state.phaseId }),
    { ok: false, error: 'not_enough_players' },
  );
  assert.deepEqual(
    await ack(room.host, 'game:start', { gameType: 'chess', phaseId: room.state.phaseId }),
    { ok: false, error: 'invalid_game' },
  );
});
