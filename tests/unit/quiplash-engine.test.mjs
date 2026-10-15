import assert from 'node:assert/strict';
import test from 'node:test';

import { QuiplashEngine } from '../../server/src/engines/quiplash.ts';

function participant(id, isAudience = false) {
  return {
    id,
    name: id,
    avatar: 'fox',
    score: 0,
    connected: true,
    isHost: false,
    isAudience,
    hasSubmitted: false,
    hasVoted: false,
    streak: 0,
  };
}

function harness(rounds = 1) {
  const players = [participant('p1'), participant('p2'), participant('p3')];
  const audience = [participant('a1', true), participant('a2', true)];
  const assignments = new Map();
  const scoreboardCalls = [];
  let timeout = null;
  let now = 1_000;
  const ctx = {
    language: 'en',
    players: () => players,
    connectedPlayers: () => players.filter((player) => player.connected),
    audience: () => audience,
    getPlayer: (id) => players.find((player) => player.id === id),
    getParticipant: (id) => [...players, ...audience].find((player) => player.id === id),
    setPhase: (_phase, _seconds, nextTimeout) => { timeout = nextTimeout; },
    emit: () => {},
    sendAssignment: (id, assignment) => assignments.set(id, assignment),
    award: (id, points) => { players.find((player) => player.id === id).score += points; },
    resetFlags: () => {
      for (const person of [...players, ...audience]) {
        person.hasSubmitted = false;
        person.hasVoted = false;
      }
    },
    toScoreboard: (seconds) => { scoreboardCalls.push(seconds); },
    now: () => now,
  };
  const engine = new QuiplashEngine(ctx, rounds);
  return {
    engine,
    ctx,
    players,
    audience,
    assignments,
    scoreboardCalls,
    fireTimeout() { assert.ok(timeout); timeout(); },
    elapse(ms) { now += ms; },
  };
}

test('assignments survive voting rejoin and mark previously submitted prompts', () => {
  const h = harness();
  h.engine.start();
  const assignment = h.assignments.get('p1');
  assert.equal(assignment.prompts.every((prompt) => prompt.submitted === false), true);
  assert.equal(h.engine.handleAnswer('p1', assignment.prompts[0].matchupId, 'human'), true);
  h.fireTimeout();

  const restored = h.engine.currentAssignment('p1');
  assert.ok(restored, 'voting reconnect needs authorship data');
  assert.equal(
    restored.prompts.find((prompt) => prompt.matchupId === assignment.prompts[0].matchupId).submitted,
    true,
  );
});

test('a removed voter takes their vote with them, and a lone human halves the pool', () => {
  const h = harness();
  h.engine.start();
  const p1Assignment = h.assignments.get('p1');
  const firstMatchupId = p1Assignment.prompts[0].matchupId;
  assert.equal(h.engine.handleAnswer('p1', firstMatchupId, 'human answer'), true);
  h.fireTimeout();

  const active = h.engine.serialize().quiplash.activeMatchup;
  assert.equal(active.id, firstMatchupId);
  const human = active.answers.find((answer) => answer.text === 'human answer');
  const safety = active.answers.find((answer) => answer.answerId !== human.answerId);
  assert.equal(h.engine.handleVote('a1', active.id, human.answerId), true);
  assert.equal(h.engine.handleVote('a2', active.id, safety.answerId), true);
  h.engine.handlePlayerRemoved('a2');

  h.fireTimeout();
  h.fireTimeout();
  h.fireTimeout();
  const result = h.engine.serialize().quiplash.lastResults
    .find((matchup) => matchup.prompt === active.prompt);
  const humanResult = result.answers.find((answer) => answer.text === 'human answer');
  // Round 1: pool is 1000 * 1 * (1 human / 2 answers) = 500, and the lone
  // surviving vote is 100% of the votes cast.
  assert.equal(humanResult.pointsAwarded, 500);
  assert.equal(humanResult.submitBonus, 100);
  const safetyResult = result.answers.find((answer) => answer.isSafety);
  assert.equal(safetyResult.pointsAwarded, 0);
  assert.equal(safetyResult.submitBonus, 0);
  assert.equal(safetyResult.votes, 0, 'removed audience votes must not survive into results');
});

test('invalid answers and votes are rejected and a complete vote advances after the minimum display', () => {
  const h = harness();
  assert.equal(h.engine.currentAssignment('p1'), null);
  assert.equal(h.engine.handleAnswer('p1', 'missing', 'answer'), false);
  assert.equal(h.engine.handleVote('p3', 'missing', 'missing'), false);

  h.engine.start();
  const assignment = h.assignments.get('p1');
  const matchupId = assignment.prompts[0].matchupId;
  assert.equal(h.engine.handleAnswer('ghost', matchupId, 'answer'), false);
  // Pairing is shuffled per round, so the non-author has to be looked up.
  const outsider = h.players.find((candidate) => !h.assignments
    .get(candidate.id).prompts.some((prompt) => prompt.matchupId === matchupId));
  assert.ok(outsider, 'every matchup has exactly one player who does not write for it');
  assert.equal(h.engine.handleAnswer(outsider.id, matchupId, 'answer'), false);
  assert.equal(
    h.engine.handleAnswer('p1', matchupId, '   '),
    false,
    'blank answers used to become a votable "…" for free',
  );
  assert.equal(h.engine.handleAnswer('p1', matchupId, 'real'), true);
  assert.equal(h.engine.handleAnswer('p1', matchupId, 'duplicate'), false);
  h.fireTimeout();

  const active = h.engine.serialize().quiplash.activeMatchup;
  const authors = h.assignments.entries()
    .filter(([, value]) => value.prompts.some((prompt) => prompt.matchupId === active.id))
    .map(([id]) => id)
    .toArray();
  const voter = h.players.find((candidate) => !authors.includes(candidate.id));
  h.audience.forEach((member) => { member.connected = false; });
  h.elapse(3_001);
  assert.equal(h.engine.handleVote(authors[0], active.id, active.answers[0].answerId), false);
  assert.equal(h.engine.handleVote('ghost', active.id, active.answers[0].answerId), false);
  assert.equal(h.engine.handleVote(voter.id, 'missing', active.answers[0].answerId), false);
  assert.equal(h.engine.handleVote(voter.id, active.id, 'missing'), false);
  assert.equal(h.engine.handleVote(voter.id, active.id, active.answers[0].answerId), true);
  assert.equal(h.engine.handleVote(voter.id, active.id, active.answers[1].answerId), false);

  h.engine.dispose();
  assert.equal(h.engine.currentAssignment('p1'), null);
});

test('neither the pairing nor the answer order follows the visible roster', () => {
  // Both orders are broadcast to everyone while a vote is open, so either one
  // tracking the roster hands the room a map from a displayed answer back to
  // the player who wrote it. Over 40 rounds both must vary.
  const coAuthors = new Set();
  const cannedShownFirst = new Set();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const h = harness();
    h.engine.start();
    const matchupId = h.assignments.get('p1').prompts[0].matchupId;
    const partner = h.players.find((candidate) => candidate.id !== 'p1' && h.assignments
      .get(candidate.id).prompts.some((prompt) => prompt.matchupId === matchupId));
    coAuthors.add(partner.id);

    assert.equal(h.engine.handleAnswer('p1', matchupId, 'real'), true);
    h.fireTimeout();
    const active = h.engine.serialize().quiplash.activeMatchup;
    assert.equal(active.id, matchupId, 'the only matchup with a real answer is the votable one');
    cannedShownFirst.add(active.answers[0].text !== 'real');
  }
  assert.deepEqual([...coAuthors].sort(), ['p2', 'p3'], 'authors must not be roster neighbours');
  assert.deepEqual(
    [...cannedShownFirst].sort(),
    [false, true],
    'a canned safety quip must not always be the last answer shown',
  );
});

test('voting skips abandoned matchups and reaches results without a voter', () => {
  const h = harness();
  h.engine.start();
  h.players.forEach((member) => { member.connected = false; });
  h.audience.forEach((member) => { member.connected = false; });
  h.engine.handlePlayerDisconnect();
  h.fireTimeout();
  assert.equal(h.engine.serialize().quiplash.activeMatchup, null);
});

test('a lone connected author is not left owing a second answer to themselves', () => {
  // Cyclic pairing seats one player opposite themselves, so they author the
  // round's only matchup twice over. Counting both seats meant their single
  // answer never marked them done and the round always ran out the clock.
  const h = harness();
  h.players[1].connected = false;
  h.players[2].connected = false;
  h.engine.start();
  const [prompt] = h.assignments.get('p1').prompts;
  assert.equal(h.engine.handleAnswer('p1', prompt.matchupId, 'solo'), true);
  assert.equal(h.players[0].hasSubmitted, true);
  assert.notEqual(h.engine.serialize().quiplash.lastResults, null, 'round should close early');
});

test('a player who reconnects mid-round, unassigned, does not hold voting open', () => {
  // Seats are dealt to whoever is online when the round starts. A player who
  // comes back later owes no answer, so waiting on them ran the answer clock out.
  const h = harness();
  h.players[2].connected = false;
  h.engine.start();
  h.players[2].connected = true;
  for (const id of ['p1', 'p2']) {
    for (const prompt of h.assignments.get(id).prompts) {
      assert.equal(h.engine.handleAnswer(id, prompt.matchupId, `${id} answer`), true);
    }
  }
  assert.notEqual(h.engine.serialize().quiplash.activeMatchup, null, 'voting opens without the timer');
});

/** With nobody writing, every matchup is canned and skipped, so answering ends on results. */
function playRoundToResults(h) {
  h.fireTimeout();
  assert.notEqual(h.engine.serialize().quiplash.lastResults, null);
}

test('a round is held on the results screen while fewer than MIN_PLAYERS are online', () => {
  const h = harness(2);
  h.engine.start();
  h.players[2].connected = false;
  playRoundToResults(h);
  h.fireTimeout();
  const view = h.engine.serialize();
  assert.equal(view.round, 1, 'no round 2 while only 2 of 3 seated players are online');
  assert.notEqual(view.quiplash.lastResults, null, 'results stay up while waiting');
  assert.equal(h.scoreboardCalls.length, 0);
});

test('a player who returns during the results wait gets the next round', () => {
  const h = harness(2);
  h.engine.start();
  h.players[2].connected = false;
  playRoundToResults(h);
  h.fireTimeout();
  assert.equal(h.engine.serialize().round, 1);
  h.players[2].connected = true;
  h.fireTimeout();
  const view = h.engine.serialize();
  assert.equal(view.round, 2);
  assert.equal(view.quiplash.lastResults, null, 'round 2 has not produced results yet');
  assert.equal(h.scoreboardCalls.length, 0);
});

test('a room still short after the three waits ends on the scoreboard', () => {
  const h = harness(2);
  h.engine.start();
  h.players[2].connected = false;
  playRoundToResults(h);
  for (let i = 0; i < 3; i += 1) h.fireTimeout();
  assert.equal(h.engine.serialize().round, 1);
  assert.deepEqual(h.scoreboardCalls, [], 'three waits are allowed before giving up');
  h.fireTimeout();
  assert.deepEqual(h.scoreboardCalls, [15]);
  assert.equal(h.engine.serialize().round, 1);
});

test('an abandoned room with nobody online still moves on as before', () => {
  const h = harness(2);
  h.engine.start();
  playRoundToResults(h);
  h.players.forEach((member) => { member.connected = false; });
  h.fireTimeout();
  assert.equal(h.engine.serialize().round, 2);
  assert.deepEqual(h.scoreboardCalls, []);
});

test('a full house moves straight from results into the next round', () => {
  const h = harness(2);
  h.engine.start();
  playRoundToResults(h);
  h.fireTimeout();
  assert.equal(h.engine.serialize().round, 2);
  assert.deepEqual(h.scoreboardCalls, []);
});

test('a restored results hold keeps a working handler with a fresh wait allowance', () => {
  const h = harness(2);
  h.engine.start();
  h.players[2].connected = false;
  playRoundToResults(h);
  h.fireTimeout();
  const restored = QuiplashEngine.restore(h.ctx, h.engine.snapshot().data);
  const handler = restored.timeoutHandler();
  assert.ok(handler, 'a restored results screen must still have a timeout');
  for (let i = 0; i < 3; i += 1) handler();
  assert.equal(restored.serialize().round, 1);
  assert.deepEqual(h.scoreboardCalls, []);
  handler();
  assert.deepEqual(h.scoreboardCalls, [15]);
});
