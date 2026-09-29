import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_CUSTOM_PROMPTS, MAX_PROMPT_LEN, MAX_PLAYERS } from '../../shared/src/index.ts';
import { Room } from '../../server/src/room.ts';
import { makeRoom } from '../helpers/room.mjs';

function seated(count, options = {}) {
  const h = makeRoom(options);
  const host = h.room.addHost('host-socket');
  const players = Array.from({ length: count }, (_, i) =>
    h.room.addPlayer(`p${i + 1}-socket`, `P${i + 1}`, 'fox')
  );
  return { ...h, host, players };
}

// ---- pause ----

test('pausing freezes the phase clock and resuming restores exactly what was left', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = seated(3);
  h.room.start('trivia', 3);
  h.advance(5_000);
  assert.equal(h.room.pause(), null);
  let state = await h.state();
  assert.equal(state.phaseEndsAt, null, 'a paused phase has no deadline');
  assert.equal(state.pausedRemainingMs, 15_000);
  assert.equal(h.room.pause(), 'invalid_phase', 'already paused');

  // A long pause: the timer must not fire behind the frozen clock.
  h.advance(60_000);
  t.mock.timers.tick(60_000);
  assert.equal((await h.state()).phase, 'answering');

  assert.equal(h.room.resume(), null);
  state = await h.state();
  assert.equal(state.pausedRemainingMs, null);
  assert.equal(state.phaseEndsAt - state.serverNow, 15_000);
  h.advance(15_000);
  t.mock.timers.tick(15_000);
  assert.equal((await h.state()).phase, 'results', 'the question ends on the restored clock');
  h.dispose();
});

test('a pause is never counted against trivia answer speed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = seated(3);
  h.room.start('trivia', 3);
  const question = (await h.state()).trivia.question;
  h.advance(2_000);
  h.room.pause();
  h.advance(30_000);
  h.room.resume();
  const correct = h.room.engine.questions[0].correctIndex;
  for (const [index, player] of h.players.entries()) {
    h.room.submitTriviaAnswer(player.playerId, question.id, index === 0 ? correct : (correct + 1) % 4);
  }
  const reveal = (await h.state()).trivia.reveal;
  const fast = reveal.pointsThisRound.find((p) => p.playerId === h.players[0].playerId);
  // 2 of 20 seconds used: base 500 + 90% of the 500 speed bonus.
  assert.equal(fast.points, 950);
  h.dispose();
});

test('a paused game does not advance when players drop, and re-checks on resume', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = seated(3);
  h.room.start('trivia', 3);
  const question = (await h.state()).trivia.question;
  h.room.submitTriviaAnswer(h.players[0].playerId, question.id, 0);
  h.room.submitTriviaAnswer(h.players[1].playerId, question.id, 0);
  h.room.pause();
  h.room.handleDisconnect('p3-socket');
  assert.equal((await h.state()).phase, 'answering', 'nothing moves while frozen');
  h.room.resume();
  assert.equal((await h.state()).phase, 'results', 'everyone still here has answered');
  h.dispose();
});

test('skipping ahead ends a pause and starts the next phase live', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = seated(3);
  h.room.start('trivia', 3);
  h.room.pause();
  assert.equal(h.room.next(), null);
  const state = await h.state();
  assert.equal(state.phase, 'results');
  assert.equal(state.pausedRemainingMs, null);
  assert.notEqual(state.phaseEndsAt, null);
  assert.equal(h.room.isPaused(), false);
  h.dispose();
});

test('there is nothing to pause without a running clock', () => {
  const h = seated(3);
  assert.equal(h.room.pause(), 'invalid_phase', 'the lobby has no timer');
  assert.equal(h.room.resume(), 'invalid_phase');
  h.dispose();
});

// ---- session standings ----

test('finished games bank into session standings, ties sharing the win', async () => {
  const h = seated(3);
  h.room.start('trivia', 3);
  const scores = [300, 300, 100];
  const players = h.room.realPlayers;
  players.forEach((player, i) => { player.score = scores[i]; });
  h.room.endGame();
  let state = await h.state();
  assert.equal(state.gamesPlayed, 1);
  assert.deepEqual(state.players.map((p) => p.sessionScore), [300, 300, 100]);
  assert.deepEqual(state.players.map((p) => p.wins), [1, 1, 0]);

  h.room.returnToLobby();
  h.room.start('trivia', 3);
  state = await h.state();
  assert.deepEqual(state.players.map((p) => p.score), [0, 0, 0], 'each game starts fresh');
  h.room.realPlayers[2].score = 900;
  h.room.endGame();
  state = await h.state();
  assert.equal(state.gamesPlayed, 2);
  assert.deepEqual(state.players.map((p) => p.sessionScore), [300, 300, 1_000]);
  assert.deepEqual(state.players.map((p) => p.wins), [1, 1, 1]);
  h.dispose();
});

test('a scoreless game is played but crowns nobody', async () => {
  const h = seated(3);
  h.room.start('quiplash', 1);
  h.room.endGame();
  const state = await h.state();
  assert.equal(state.gamesPlayed, 1);
  assert.ok(state.players.every((p) => p.wins === 0));
  h.dispose();
});

// ---- seats ----

test('the host can bench a player, and a benched player stays benched at start', async () => {
  const h = seated(4);
  const benched = h.players[3].playerId;
  assert.equal(h.room.setSeat(benched, true), null);
  let state = await h.state();
  assert.equal(state.players.length, 3);
  assert.ok(state.audience.some((a) => a.id === benched));

  assert.equal(h.room.start('trivia', 3), null);
  state = await h.state();
  assert.ok(state.audience.some((a) => a.id === benched), 'start must not re-promote them');
  assert.equal(h.room.setSeat(benched, false), 'invalid_phase', 'seating is a lobby action');

  h.room.returnToLobby();
  assert.equal(h.room.setSeat(benched, false), null);
  state = await h.state();
  assert.equal(state.players.length, 4);
  h.dispose();
});

test('seat changes respect capacity and refuse the host', () => {
  const h = seated(MAX_PLAYERS);
  const spectator = h.room.addPlayer('a1-socket', 'A1', 'cat', true);
  assert.equal(h.room.setSeat(spectator.playerId, false), 'room_full');
  assert.equal(h.room.setSeat(h.host.playerId, true), 'invalid_target');
  assert.equal(h.room.setSeat('nobody', true), 'invalid_target');
  assert.equal(h.room.setSeat(spectator.playerId, true), null, 'a no-op is not an error');
  h.dispose();
});

test('a stand-in controller may pause but never reseat people or load prompts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = seated(3, { controllerFailoverMs: 1_000 });
  h.room.handleDisconnect('host-socket');
  h.advance(1_001);
  t.mock.timers.tick(1_001);
  const controller = (await h.state()).controllerPlayerId;
  assert.equal(controller, h.players[0].playerId);
  assert.equal(h.room.can(controller, 'pause'), true);
  assert.equal(h.room.can(controller, 'seat'), false);
  assert.equal(h.room.can(controller, 'content'), false);
  h.dispose();
});

// ---- custom prompts ----

test('custom prompts are sanitized, de-duplicated and bounded', async () => {
  const h = seated(3);
  const long = 'x'.repeat(MAX_PROMPT_LEN + 20);
  const result = h.room.setCustomPrompts([
    '  The worst   pizza topping  ',
    'the WORST pizza topping',
    '',
    '‮flipped‬ text',
    42,
    long,
  ]);
  assert.deepEqual(result, { count: 3 });
  assert.equal((await h.state()).customPromptCount, 3);
  assert.equal(h.room.customPrompts[1], 'flipped text', 'bidi controls are stripped');
  assert.equal(h.room.customPrompts[2].length, MAX_PROMPT_LEN);

  assert.deepEqual(h.room.setCustomPrompts('nope'), { error: 'invalid_prompts' });
  assert.deepEqual(
    h.room.setCustomPrompts(Array.from({ length: MAX_CUSTOM_PROMPTS + 1 }, (_, i) => `p${i}`)),
    { error: 'invalid_prompts' },
  );
  assert.deepEqual(h.room.setCustomPrompts([]), { count: 0 });
  h.dispose();
});

test('a quiplash game plays the custom pack before the built-in prompts', async () => {
  const h = seated(3);
  const pack = ['Custom one', 'Custom two', 'Custom three'];
  h.room.setCustomPrompts(pack);
  h.room.start('quiplash', 1);
  await h.state();
  const handed = new Set();
  for (const assignment of h.assignments.values()) {
    for (const prompt of assignment.prompts) handed.add(prompt.prompt);
  }
  assert.deepEqual([...handed].sort(), [...pack].sort(), 'three matchups, three custom prompts');
  assert.deepEqual(h.room.setCustomPrompts(['x']), { error: 'invalid_phase' });
  h.dispose();
});

// ---- highlights ----

test('the scoreboard shows the most-voted answers of the game', async () => {
  const h = seated(3);
  h.room.start('quiplash', 1);
  await h.state();
  const byPlayer = new Map(h.players.map((p) => [p.playerId, `${p.playerId.slice(0, 4)}`]));
  for (const player of h.players) {
    const socket = [...h.assignments.keys()].find((s) => h.room.pidForSocket(s) === player.playerId);
    for (const prompt of h.assignments.get(socket).prompts) {
      h.room.submitAnswer(player.playerId, prompt.matchupId, `answer by ${byPlayer.get(player.playerId)} ${prompt.matchupId.slice(0, 4)}`);
    }
  }
  let state = await h.state();
  assert.equal(state.phase, 'voting');
  // Every voter picks the first answer on screen until the round ends.
  for (let guard = 0; guard < 10 && state.phase === 'voting'; guard += 1) {
    const matchup = state.quiplash.activeMatchup;
    for (const player of h.players) {
      const first = matchup.answers[0].answerId;
      h.room.submitVote(player.playerId, matchup.id, first);
    }
    h.room.next();
    state = await h.state();
  }
  assert.equal(state.phase, 'results');
  const results = state.quiplash.lastResults;
  const winner = results[0].answers.find((a) => a.votes > 0);
  assert.equal(winner.voters.length, winner.votes, 'every vote is credited to a voter');
  assert.ok(winner.voters.every((v) => typeof v.name === 'string' && typeof v.avatar === 'string'));

  h.room.endGame();
  state = await h.state();
  assert.ok(state.highlights.length > 0 && state.highlights.length <= 3);
  assert.equal(state.highlights[0].kind, 'quip');
  assert.ok(state.highlights[0].votes >= state.highlights.at(-1).votes, 'best first');
  h.room.returnToLobby();
  assert.equal((await h.state()).highlights, null, 'highlights belong to the scoreboard');
  h.dispose();
});

// ---- restart snapshots ----

test('a snapshot rebuilds a room mid-game that players can resume into', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = seated(3, { restoreGraceMs: 10_000 });
  h.room.setCustomPrompts(['Snapshot prompt']);
  h.room.start('quiplash', 2);
  await h.state();
  const [first] = h.players;
  const firstSocket = 'p1-socket';
  const matchupId = h.assignments.get(firstSocket).prompts[0].matchupId;
  assert.equal(h.room.submitAnswer(first.playerId, matchupId, 'saved answer'), true);
  h.advance(20_000);
  const before = await h.state();

  const snapshot = JSON.parse(JSON.stringify(h.room.toSnapshot()));
  assert.equal(snapshot.remainingMs, 40_000);
  assert.ok(!JSON.stringify(snapshot).includes(first.resumeToken), 'tokens are stored hashed');

  const states = [];
  const assignments = new Map();
  let wall = 1_800_000_000_000;
  const restored = Room.fromSnapshot(
    snapshot,
    (state) => states.push(state),
    (socketId, assignment) => assignments.set(socketId, assignment),
    { restoreGraceMs: 10_000, wallNow: () => wall, monotonicNow: () => 5_000 },
  );
  restored.emit();
  await Promise.resolve();
  let state = states.at(-1);
  assert.equal(state.phase, 'answering');
  assert.equal(state.round, before.round);
  assert.equal(state.customPromptCount, 1);
  assert.ok(state.players.every((p) => !p.connected), 'every socket died with the old process');
  assert.equal(state.phaseEndsAt - wall, 50_000, 'what was left, plus the grace period');
  assert.ok(state.phaseId > before.phaseId, 'commands composed before the restart are stale');

  const resumed = restored.rejoin(first.resumeToken, 'new-socket');
  assert.ok(resumed, 'the stored resume token still works');
  restored.resendAssignment(resumed.playerId);
  const assignment = assignments.get('new-socket');
  assert.equal(
    assignment.prompts.find((p) => p.matchupId === matchupId).submitted,
    true,
    'the answer written before the restart survived',
  );
  assert.equal(restored.rejoin(first.resumeToken, 'replay'), null, 'and rotated as usual');

  // The re-armed timer drives the game on.
  wall += 50_000;
  t.mock.timers.tick(50_000);
  await Promise.resolve();
  state = states.at(-1);
  assert.notEqual(state.phase, 'answering');
  restored.dispose();
  h.dispose();
});

test('a paused game comes back paused, and a lobby comes back as a lobby', async () => {
  const h = seated(3);
  h.room.start('bluff', 2);
  h.room.pause();
  const paused = Room.fromSnapshot(
    JSON.parse(JSON.stringify(h.room.toSnapshot())),
    () => {},
    () => {},
  );
  assert.equal(paused.isPaused(), true);
  assert.equal(paused.resume(), null);
  paused.dispose();
  h.dispose();

  const lobby = seated(3);
  const back = Room.fromSnapshot(JSON.parse(JSON.stringify(lobby.room.toSnapshot())), () => {}, () => {});
  assert.equal(back.inLobby(), true);
  assert.throws(
    () => Room.fromSnapshot({ ...lobby.room.toSnapshot(), version: 99 }, () => {}, () => {}),
    /unsupported room snapshot version/,
  );
  back.dispose();
  lobby.dispose();
});

test('a corrupt stored resume hash cannot break rejoin for the rest of the room', () => {
  const h = seated(3);
  const [first, second] = h.players;
  const snapshot = JSON.parse(JSON.stringify(h.room.toSnapshot()));
  // The host's entry is first in the map, so every lookup would compare
  // against it before reaching anyone else's.
  const hostEntry = snapshot.sessionSecrets.find(([id]) => id === h.host.playerId);
  hostEntry[1] = 'abcd';

  const restored = Room.fromSnapshot(snapshot, () => {}, () => {});
  assert.ok(restored.rejoin(second.resumeToken, 'second-socket'), 'an intact hash still resumes');
  assert.equal(restored.rejoin(h.host.resumeToken, 'host-socket'), null, 'the damaged one cannot');
  assert.ok(restored.rejoin(first.resumeToken, 'first-socket'));
  restored.dispose();
  h.dispose();
});
