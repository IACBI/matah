import assert from 'node:assert/strict';
import { io as createClient } from 'socket.io-client';

/**
 * Socket.IO client plumbing shared by the integration suites.
 *
 * Everything here is event-driven: waits are expressed as "until the room
 * state satisfies this predicate", never as a fixed sleep, so a slow CI runner
 * makes the suite slower rather than red.
 */
export function clients(getBaseUrl) {
  const live = new Set();

  async function connect(headers) {
    const socket = createClient(getBaseUrl(), {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      ...(headers ? { extraHeaders: headers } : {}),
    });
    live.add(socket);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connect timeout')), 5_000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
    });
    return socket;
  }

  function ack(socket, event, payload) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${event} acknowledgement timeout`)),
        5_000,
      );
      const callback = (result) => { clearTimeout(timer); resolve(result); };
      if (payload === undefined) socket.emit(event, callback);
      else socket.emit(event, payload, callback);
    });
  }

  function once(socket, event, timeoutMs = 5_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${event} event timeout`)), timeoutMs);
      socket.once(event, (value) => { clearTimeout(timer); resolve(value); });
    });
  }

  /** Resolve once a `room:state` satisfying `predicate` arrives. */
  function until(socket, predicate, label = 'state', timeoutMs = 5_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
      const listener = (state) => {
        if (!predicate(state)) return;
        clearTimeout(timer);
        socket.off('room:state', listener);
        resolve(state);
      };
      socket.on('room:state', listener);
    });
  }

  /** A host plus `count` joined players, settled and ready to start. */
  async function createRoomWithPlayers(count = 3) {
    const host = await connect();
    let state;
    host.on('room:state', (next) => { state = next; });
    const created = await ack(host, 'room:create', { language: 'en' });
    assert.equal(created.ok, true);

    const seated = until(host, (next) => next.players.length === count, `${count} players`);
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
    await seated;
    return { host, hostSession: created.data, members, get state() { return state; } };
  }

  function disconnectAll() {
    for (const socket of live) socket.disconnect();
    live.clear();
  }

  return { connect, ack, once, until, createRoomWithPlayers, disconnectAll };
}
