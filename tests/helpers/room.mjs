import assert from 'node:assert/strict';

import { Room } from '../../server/src/room.ts';

/** A `Player` shaped exactly like the one `Room.newPlayer` builds. */
export function participant(id, flags = {}) {
  return {
    id,
    name: flags.name ?? id,
    avatar: flags.avatar ?? 'fox',
    score: 0,
    connected: flags.connected ?? true,
    isHost: flags.isHost ?? false,
    isAudience: flags.isAudience ?? false,
    hasSubmitted: false,
    hasVoted: false,
    streak: 0,
  };
}

/**
 * A `Room` wired to a controllable clock, with the last broadcast captured.
 *
 * `Room` batches broadcasts on a microtask, so `state()` awaits the flush
 * rather than reading a value that may not have been produced yet.
 */
export function makeRoom(options = {}) {
  let wall = options.startWallMs ?? 1_700_000_000_000;
  let monotonic = options.startMonotonicMs ?? 1_000;
  const states = [];
  const assignments = new Map();

  const room = new Room(
    options.code ?? 'ABCD',
    options.language ?? 'en',
    (next) => states.push(next),
    (socketId, assignment) => assignments.set(socketId, assignment),
    {
      ...options,
      wallNow: () => wall,
      monotonicNow: () => monotonic,
    }
  );

  return {
    room,
    assignments,
    /** Every broadcast so far, oldest first. */
    states,
    /** The most recent broadcast, after pending microtask flushes settle. */
    async state() {
      await Promise.resolve();
      assert.ok(states.length > 0, 'expected the room to have broadcast');
      return states.at(-1);
    },
    /** Advance both clocks; timers still need their own trigger. */
    advance(ms) {
      wall += ms;
      monotonic += ms;
    },
    dispose() {
      room.dispose();
    },
  };
}

/** Add a host plus `count` connected players, returning their sessions. */
export function seatPlayers(room, count, offset = 0) {
  return Array.from({ length: count }, (_, index) =>
    room.addPlayer(`p${offset + index + 1}-socket`, `P${offset + index + 1}`, 'fox')
  );
}
