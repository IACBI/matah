import assert from 'node:assert/strict';
import test from 'node:test';

import { makeRoom } from '../helpers/room.mjs';

test('disconnected members keep a short lease and are then removed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = makeRoom({ code: 'ABCD', memberExpiryMs: 20_000, controllerFailoverMs: 10_000 });
  h.room.addHost('host-socket');
  const member = h.room.addPlayer('player-socket', 'Player', 'fox');
  h.room.emit();

  h.room.handleDisconnect('player-socket');
  h.room.emit();
  let state = await h.state();
  assert.equal(state.players.find((p) => p.id === member.playerId)?.connected, false);
  assert.equal(h.room.isFull(), false);

  h.advance(20_001);
  t.mock.timers.tick(20_001);
  h.room.emit();
  state = await h.state();
  assert.equal(state.players.some((p) => p.id === member.playerId), false);
  assert.equal(h.room.pidForSocket('player-socket'), null);
  h.dispose();
});

test('host failover elects one deterministic connected controller', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = makeRoom({ code: 'EFGH', memberExpiryMs: 100_000, controllerFailoverMs: 15_000 });
  const host = h.room.addHost('host-socket');
  const first = h.room.addPlayer('p1-socket', 'First', 'fox');
  h.room.addPlayer('p2-socket', 'Second', 'cat');
  h.room.addPlayer('p3-socket', 'Third', 'frog');
  h.room.handleDisconnect('host-socket');

  h.advance(15_001);
  t.mock.timers.tick(15_001);
  h.room.emit();
  let state = await h.state();
  assert.equal(state.hostConnected, false);
  assert.equal(state.controllerPlayerId, first.playerId);
  assert.equal(h.room.canControl(first.playerId), true);

  const resumed = h.room.rejoin(host.resumeToken, 'host-return');
  assert.ok(resumed);
  h.room.emit();
  state = await h.state();
  assert.equal(state.hostConnected, true);
  assert.equal(state.controllerPlayerId, null);
  h.dispose();
});
