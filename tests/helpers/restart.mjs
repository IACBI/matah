import assert from 'node:assert/strict';

import { clients } from './socket.mjs';

/**
 * Restart-persistence scenarios shared by the file and Redis suites.
 *
 * Each suite configures its store through the environment before importing
 * the server, and runs in its own process, so one module instance restarted in
 * place stands for the old and the new server: `stopServer()` saves every room
 * and drops it from memory, and `startServer()` has only the store to go on.
 */

/** Set up a mid-game room: quiplash answering, one answer in, a custom pack. */
export async function playUntilMidRound(io) {
  const room = await io.createRoomWithPlayers(3);
  await io.ack(room.host, 'room:setCustomPrompts', { prompts: ['Survives a restart'], phaseId: room.state.phaseId });
  const assignments = room.members.map(({ socket }) => io.once(socket, 'player:assignment'));
  const started = io.until(room.host, (s) => s.phase === 'answering', 'answering');
  await io.ack(room.host, 'game:start', { gameType: 'quiplash', rounds: 2, phaseId: room.state.phaseId });
  const before = await started;
  const [first] = await Promise.all(assignments);
  assert.deepEqual(
    await io.ack(room.members[0].socket, 'answer:submit', {
      matchupId: first.prompts[0].matchupId,
      text: 'Written before the restart',
    }),
    { ok: true, data: null },
  );
  return { room, before, answeredMatchup: first.prompts[0].matchupId };
}

/** Rejoin everyone on the new server and check the game picked up where it was. */
export async function resumeAndFinishRound(io, { room, before, answeredMatchup }) {
  const host = await io.connect();
  const hostState = io.once(host, 'room:state');
  const rejoined = await io.ack(host, 'room:rejoin', { code: before.code, resumeToken: room.hostSession.resumeToken });
  assert.equal(rejoined.ok, true, 'the host resumes with the token it already had');
  const state = await hostState;
  assert.equal(state.phase, 'answering');
  assert.equal(state.round, before.round);
  assert.equal(state.customPromptCount, 1);
  assert.equal(state.players.length, 3);
  assert.ok(state.phaseEndsAt - state.serverNow > 45_000, 'the phase clock kept its time plus a grace period');

  const players = [];
  for (const member of room.members) {
    const socket = await io.connect();
    const assignment = io.once(socket, 'player:assignment');
    const result = await io.ack(socket, 'room:rejoin', { code: before.code, resumeToken: member.session.resumeToken });
    assert.equal(result.ok, true);
    players.push({ socket, assignment: await assignment });
  }
  const mine = players[0].assignment.prompts.find((p) => p.matchupId === answeredMatchup);
  assert.equal(mine.submitted, true, 'an answer from before the restart is still in');

  // Finish answering: the restored engine must drive the game on.
  const voting = io.until(host, (s) => s.phase === 'voting', 'voting after restore', 10_000);
  for (const { socket, assignment } of players) {
    for (const prompt of assignment.prompts.filter((p) => !p.submitted)) {
      assert.deepEqual(
        await io.ack(socket, 'answer:submit', { matchupId: prompt.matchupId, text: 'After the restart' }),
        { ok: true, data: null },
      );
    }
  }
  await voting;
}

/** Play into a round, restart the server in place, and resume on the far side. */
export async function gracefulRestart(server) {
  let baseUrl = `http://127.0.0.1:${await server.startServer(0)}`;
  const io = clients(() => baseUrl);
  try {
    const game = await playUntilMidRound(io);
    io.disconnectAll();
    await server.stopServer();

    baseUrl = `http://127.0.0.1:${await server.startServer(0)}`;
    await resumeAndFinishRound(io, game);
    return game;
  } finally {
    io.disconnectAll();
    await server.stopServer();
  }
}
