import assert from 'node:assert/strict';
import test from 'node:test';

import { Room } from '../../server/src/room.ts';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('disconnected members keep a short lease and are then removed', async () => {
  let state;
  const room = new Room('ABCD', 'en', (next) => { state = next; }, () => {}, {
    memberExpiryMs: 20,
    controllerFailoverMs: 10,
  });
  room.addHost('host-socket');
  const member = room.addPlayer('player-socket', 'Player', 'fox');
  room.emit();

  room.handleDisconnect('player-socket');
  room.emit();
  assert.equal(state.players.find((p) => p.id === member.playerId)?.connected, false);
  assert.equal(room.isFull(), false);

  await delay(35);
  room.emit();
  assert.equal(state.players.some((p) => p.id === member.playerId), false);
  assert.equal(room.pidForSocket('player-socket'), null);
  room.dispose();
});

test('host failover elects one deterministic connected controller', async () => {
  let state;
  const room = new Room('EFGH', 'en', (next) => { state = next; }, () => {}, {
    memberExpiryMs: 100,
    controllerFailoverMs: 15,
  });
  const host = room.addHost('host-socket');
  const first = room.addPlayer('p1-socket', 'First', 'fox');
  room.addPlayer('p2-socket', 'Second', 'cat');
  room.addPlayer('p3-socket', 'Third', 'frog');
  room.handleDisconnect('host-socket');

  await delay(30);
  room.emit();
  assert.equal(state.hostConnected, false);
  assert.equal(state.controllerPlayerId, first.playerId);
  assert.equal(room.canControl(first.playerId), true);

  const resumed = room.rejoin(host.resumeToken, 'host-return');
  assert.ok(resumed);
  room.emit();
  assert.equal(state.hostConnected, true);
  assert.equal(state.controllerPlayerId, null);
  room.dispose();
});
