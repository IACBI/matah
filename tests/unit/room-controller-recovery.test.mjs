import assert from 'node:assert/strict';
import test from 'node:test';

import { makeRoom } from '../helpers/room.mjs';

/** Host and three players, then everyone drops and the failover window passes. */
function everyoneOfflinePastFailover(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = makeRoom({ controllerFailoverMs: 10_000, memberExpiryMs: 1_000_000 });
  const host = h.room.addHost('host-socket');
  const players = ['p1', 'p2', 'p3'].map((id) =>
    h.room.addPlayer(`${id}-socket`, id.toUpperCase(), 'fox')
  );
  for (const socket of ['host-socket', 'p1-socket', 'p2-socket', 'p3-socket']) {
    h.room.handleDisconnect(socket);
  }
  h.advance(10_001);
  t.mock.timers.tick(10_001);
  for (const p of players) {
    assert.equal(h.room.can(p.playerId, 'advance'), false, 'nobody was online to elect');
  }
  return { ...h, host, players };
}

test('a player who reconnects after the failover window becomes the controller', (t) => {
  const h = everyoneOfflinePastFailover(t);

  h.room.rejoin(h.players[1].resumeToken, 'p2-return');

  assert.equal(h.room.can(h.players[1].playerId, 'advance'), true);
  assert.equal(h.room.can(h.players[0].playerId, 'advance'), false, 'only one stand-in');
  assert.equal(h.room.can(h.players[1].playerId, 'kick'), false, 'kick stays with the host');
  h.dispose();
});

test('socket recovery after the failover window elects a controller too', (t) => {
  const h = everyoneOfflinePastFailover(t);

  assert.equal(h.room.recoverSocket('p3-socket'), h.players[2].playerId);

  assert.equal(h.room.can(h.players[2].playerId, 'advance'), true);
  h.dispose();
});

test('a controller who is already elected is not replaced by a later reconnect', (t) => {
  const h = everyoneOfflinePastFailover(t);
  h.room.rejoin(h.players[0].resumeToken, 'p1-return');
  h.room.rejoin(h.players[1].resumeToken, 'p2-return');

  assert.equal(h.room.can(h.players[0].playerId, 'advance'), true);
  assert.equal(h.room.can(h.players[1].playerId, 'advance'), false);
  h.dispose();
});

test('the host returning still takes control back from a late stand-in', (t) => {
  const h = everyoneOfflinePastFailover(t);
  h.room.rejoin(h.players[1].resumeToken, 'p2-return');

  h.room.rejoin(h.host.resumeToken, 'host-return');

  assert.equal(h.room.can(h.host.playerId, 'advance'), true);
  assert.equal(h.room.can(h.players[1].playerId, 'advance'), false);
  h.dispose();
});

test('a refused start leaves spectators in the audience', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = makeRoom();
  h.room.addHost('host-socket');
  h.room.addPlayer('p1-socket', 'P1', 'fox');
  h.room.addPlayer('a1-socket', 'Watcher', 'cat', true);

  assert.equal(h.room.start('trivia', 3), 'not_enough_players');

  assert.equal(h.room.realPlayers.length, 1);
  assert.equal(h.room.audiencePlayers.length, 1, 'the spectator was not seated by a failed start');
  h.dispose();
});

test('a start that spectators make viable seats them', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = makeRoom();
  h.room.addHost('host-socket');
  h.room.addPlayer('p1-socket', 'P1', 'fox');
  h.room.addPlayer('p2-socket', 'P2', 'fox');
  h.room.addPlayer('a1-socket', 'Watcher', 'cat', true);

  assert.equal(h.room.start('trivia', 3), null);

  assert.equal(h.room.realPlayers.length, 3);
  assert.equal(h.room.audiencePlayers.length, 0);
  h.dispose();
});

test('removing the last unanswered player during a pause advances the phase but keeps it paused', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = makeRoom({ memberExpiryMs: 1_000_000 });
  h.room.addHost('host-socket');
  const players = ['p1', 'p2', 'p3', 'p4'].map((id) =>
    h.room.addPlayer(`${id}-socket`, id.toUpperCase(), 'fox')
  );
  assert.equal(h.room.start('trivia', 3), null);
  const state = await h.state();
  const question = state.trivia.question;
  for (const p of players.slice(0, 3)) h.room.submitTriviaAnswer(p.playerId, question.id, 0);
  assert.equal(h.room.pause(), null);

  h.room.kick(players[3].playerId);

  const after = await h.state();
  assert.equal(after.phase, 'results', 'the kick completed the question');
  assert.notEqual(after.pausedRemainingMs, null, 'but the host\'s pause still holds');
  assert.equal(after.phaseEndsAt, null);
  assert.equal(h.room.resume(), null);
  h.dispose();
});

test('freezing the clocks keeps the phase and its deadline but stops the timer from advancing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = makeRoom();
  h.room.addHost('host-socket');
  for (const id of ['p1', 'p2', 'p3']) h.room.addPlayer(`${id}-socket`, id.toUpperCase(), 'fox');
  assert.equal(h.room.start('trivia', 3), null);
  const before = await h.state();

  h.room.freezeClocks();
  h.advance(120_000);
  t.mock.timers.tick(120_000);

  const after = await h.state();
  assert.equal(after.phase, before.phase, 'an expired deadline no longer advances the game');
  assert.equal(after.phaseEndsAt, before.phaseEndsAt, 'clients still see the saved deadline');
  assert.equal(after.trivia.question.id, before.trivia.question.id);
  h.dispose();
});
