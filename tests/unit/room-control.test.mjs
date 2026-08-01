import assert from 'node:assert/strict';
import test from 'node:test';

import { makeRoom } from '../helpers/room.mjs';

const CAPABILITIES = ['start', 'advance', 'end', 'restart', 'rematch', 'language', 'kick'];

/** A room with a host, three seated players, and one spectator. */
function lobby(options = {}) {
  const h = makeRoom({ controllerFailoverMs: 10_000, ...options });
  const host = h.room.addHost('host-socket');
  const players = ['p1', 'p2', 'p3'].map((id) =>
    h.room.addPlayer(`${id}-socket`, id.toUpperCase(), 'fox')
  );
  const spectator = h.room.addPlayer('a1-socket', 'Watcher', 'cat', true);
  return { ...h, host, players, spectator };
}

test('only the host holds every capability while connected', () => {
  const room = lobby();
  for (const capability of CAPABILITIES) {
    assert.equal(room.room.can(room.host.playerId, capability), true, capability);
    assert.equal(room.room.can(room.players[1].playerId, capability), false, capability);
    assert.equal(room.room.can(room.spectator.playerId, capability), false, capability);
  }
  room.dispose();
});

test('the elected stand-in controller inherits everything except kick', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const room = lobby();
  room.room.handleDisconnect('host-socket');
  room.advance(10_001);
  t.mock.timers.tick(10_001);

  const controller = room.players[0].playerId;
  for (const capability of CAPABILITIES) {
    assert.equal(
      room.room.can(controller, capability),
      capability !== 'kick',
      `controller should ${capability === 'kick' ? 'not ' : ''}hold ${capability}`,
    );
  }
  // A non-elected player gains nothing from the failover.
  assert.equal(room.room.can(room.players[1].playerId, 'advance'), false);
  room.dispose();
});

test('a disconnected host holds nothing, and reconnecting revokes the stand-in', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const room = lobby();
  room.room.handleDisconnect('host-socket');
  room.advance(10_001);
  t.mock.timers.tick(10_001);
  assert.equal(room.room.can(room.host.playerId, 'end'), false);

  room.room.rejoin(room.host.resumeToken, 'host-return');
  assert.equal(room.room.can(room.host.playerId, 'end'), true);
  assert.equal(room.room.can(room.players[0].playerId, 'advance'), false);
  room.dispose();
});

test('a stale phaseId is reported before a permission failure', () => {
  const room = lobby();
  const staleId = 999;
  assert.equal(
    room.room.controlError(room.players[1].playerId, staleId, 'kick'),
    'stale_phase',
    'leaking "host_only" for a stale id would tell a caller who is in charge',
  );
  assert.equal(room.room.controlError(room.players[1].playerId, 0, 'kick'), 'host_only');
  assert.equal(room.room.controlError(room.host.playerId, 0, 'kick'), null);
  // A non-integer phaseId must never coerce into a match.
  assert.equal(room.room.controlError(room.host.playerId, '0', 'kick'), 'stale_phase');
  assert.equal(room.room.controlError(room.host.playerId, null, 'kick'), 'stale_phase');
  room.dispose();
});
