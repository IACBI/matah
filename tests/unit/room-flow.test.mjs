import assert from 'node:assert/strict';
import test from 'node:test';

import { makeRoom } from '../helpers/room.mjs';

/** A room with a host and `count` seated players, plus `spectators`. */
function seated(count, spectators = 0, options = {}) {
  const h = makeRoom(options);
  h.room.addHost('host-socket');
  const players = Array.from({ length: count }, (_, i) =>
    h.room.addPlayer(`p${i + 1}-socket`, `P${i + 1}`, 'fox')
  );
  const audience = Array.from({ length: spectators }, (_, i) =>
    h.room.addPlayer(`a${i + 1}-socket`, `A${i + 1}`, 'cat', true)
  );
  return { ...h, players, audience };
}

test('game:next advances immediately and refuses outside a timed phase', () => {
  const room = seated(3);
  assert.equal(room.room.next(), 'invalid_phase', 'the lobby has no timer to skip');

  assert.equal(room.room.start('trivia', 3), null);
  // Skipping right away is the button working as intended; the burst budget
  // lives in the cost-4 charge on the socket and address buckets, not here.
  assert.equal(room.room.next(), null);
  room.dispose();
});

test('a room dropping below the player floor ends to the scoreboard', async () => {
  const room = seated(3);
  assert.equal(room.room.start('quiplash', 1), null);
  assert.equal((await room.state()).phase, 'answering');

  room.room.leaveBySocket('p3-socket');
  const state = await room.state();
  assert.equal(state.phase, 'scoreboard', 'two players can never produce a votable matchup');
  assert.equal(state.players.length, 2);
  room.dispose();
});

test('ending a game drops the abandoned engine but keeps the round counters', async () => {
  const room = seated(3);
  assert.equal(room.room.start('quiplash', 4), null);
  const playing = await room.state();
  assert.equal(playing.totalRounds, 4);
  assert.ok(playing.quiplash, 'an in-progress game serializes its engine view');

  assert.equal(room.room.endGame(), null);
  const scoreboard = await room.state();
  assert.equal(scoreboard.phase, 'scoreboard');
  assert.equal(scoreboard.quiplash, undefined, 'mid-round results must not survive');
  assert.equal(scoreboard.round, 1, 'the header still knows where the game stopped');
  assert.equal(scoreboard.totalRounds, 4);
  room.dispose();
});

test('spectators are given seats when a game starts, restarts, or rematches', async () => {
  const room = seated(2, 2);
  // Two seated players is below the floor; the spectators make it playable.
  assert.equal(room.room.start('trivia', 3), null);
  let state = await room.state();
  assert.equal(state.players.length, 4);
  assert.equal(state.audience.length, 0);

  assert.equal(room.room.returnToLobby(), null);
  const late = room.room.addPlayer('a3-socket', 'Late', 'frog', true);
  assert.equal(room.room.start('trivia', 3), null);
  state = await room.state();
  assert.equal(
    state.players.some((p) => p.id === late.playerId),
    true,
    'someone who joined late should play the next game',
  );
  room.dispose();
});

test('one action produces one broadcast and at most one phaseId bump', async () => {
  const room = seated(3, 1);
  room.room.emit(); // the socket layer broadcasts once after each join
  const phaseIdBefore = (await room.state()).phaseId;
  const before = room.states.length;

  const kicked = room.room.kick(room.players[2].playerId);
  assert.equal(kicked.ok, true);

  const after = await room.state();
  assert.equal(
    room.states.length - before,
    1,
    'kick used to emit three times: engine purge, removeMember, and bumpRevision',
  );
  assert.equal(
    after.phaseId - phaseIdBefore,
    1,
    'two bumps would invalidate the caller\'s own next command',
  );
  room.dispose();
});

test('a room is reclaimed once idle, whether or not a tab is still open', () => {
  const room = seated(3);
  const IDLE = 30 * 60_000;
  const ABANDONED = 5 * 60_000;

  assert.equal(room.room.isStale(IDLE, ABANDONED), false);

  // Everyone drops: reclaimable at the shorter threshold.
  for (const socket of ['host-socket', 'p1-socket', 'p2-socket', 'p3-socket']) {
    room.room.handleDisconnect(socket);
  }
  room.advance(ABANDONED + 1);
  assert.equal(room.room.isStale(IDLE, ABANDONED), true);
  room.dispose();
});

test('a silent room with a connected tab still expires at the hard limit', () => {
  const room = seated(3);
  const IDLE = 30 * 60_000;
  const ABANDONED = 5 * 60_000;

  room.advance(ABANDONED + 1);
  assert.equal(room.room.isStale(IDLE, ABANDONED), false, 'someone is still connected');
  room.advance(IDLE);
  assert.equal(
    room.room.isStale(IDLE, ABANDONED),
    true,
    'a forgotten browser tab must not pin a room slot forever',
  );
  room.dispose();
});
