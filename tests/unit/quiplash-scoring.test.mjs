import assert from 'node:assert/strict';
import test from 'node:test';

import { QuiplashEngine } from '../../server/src/engines/quiplash.ts';
import { participant } from '../helpers/room.mjs';

/**
 * A quiplash engine over `playerCount` players and `audienceCount` spectators,
 * with the phase timeout exposed so a round can be driven deterministically.
 */
function harness({ playerCount = 3, audienceCount = 2, rounds = 1 } = {}) {
  const players = Array.from({ length: playerCount }, (_, i) => participant(`p${i + 1}`));
  const audience = Array.from({ length: audienceCount }, (_, i) =>
    participant(`a${i + 1}`, { isAudience: true })
  );
  const everyone = [...players, ...audience];
  const assignments = new Map();
  let timeout = null;
  let now = 1_000;

  const engine = new QuiplashEngine({
    language: 'en',
    players: () => players,
    connectedPlayers: () => players.filter((p) => p.connected),
    audience: () => audience,
    getPlayer: (id) => players.find((p) => p.id === id),
    getParticipant: (id) => everyone.find((p) => p.id === id),
    setPhase: (_phase, _seconds, next) => { timeout = next; },
    emit: () => {},
    sendAssignment: (id, assignment) => assignments.set(id, assignment),
    award: (id, points) => { everyone.find((p) => p.id === id).score += points; },
    resetFlags: () => {
      for (const person of everyone) {
        person.hasSubmitted = false;
        person.hasVoted = false;
      }
    },
    toScoreboard: () => {},
    now: () => now,
  }, rounds);
  engine.start();

  return {
    engine,
    players,
    audience,
    assignments,
    scoreOf: (id) => everyone.find((p) => p.id === id).score,
    fire() { assert.ok(timeout, 'expected a pending phase timeout'); timeout(); },
    elapse(ms) { now += ms; },
    active: () => engine.serialize().quiplash.activeMatchup,
    results: () => engine.serialize().quiplash.lastResults,
    /** Vote through every remaining matchup, then land on results. */
    finish() {
      for (let guard = 0; guard < 40; guard += 1) {
        if (engine.serialize().quiplash.lastResults) return;
        this.fire();
      }
      assert.fail('round never reached results');
    },
  };
}

/** The matchup both of the given players author (there is exactly one). */
function matchupFor(h, playerId) {
  return h.assignments.get(playerId).prompts[0].matchupId;
}

test('two real answers split the pool by vote share', () => {
  const h = harness();
  const shared = h.assignments.get('p1').prompts
    .find((prompt) => h.assignments.get('p2').prompts.some((o) => o.matchupId === prompt.matchupId));
  assert.ok(shared, 'p1 and p2 co-author a matchup');
  assert.equal(h.engine.handleAnswer('p1', shared.matchupId, 'from p1'), true);
  assert.equal(h.engine.handleAnswer('p2', shared.matchupId, 'from p2'), true);
  h.fire();

  const active = h.active();
  assert.equal(active.id, shared.matchupId);
  const first = active.answers.find((a) => a.text === 'from p1');
  const second = active.answers.find((a) => a.text === 'from p2');
  // Three voters: two for p1, one for p2.
  assert.equal(h.engine.handleVote('p3', active.id, first.answerId), true);
  assert.equal(h.engine.handleVote('a1', active.id, first.answerId), true);
  assert.equal(h.engine.handleVote('a2', active.id, second.answerId), true);
  h.finish();

  const result = h.results().find((m) => m.prompt === active.prompt);
  const pool = 1_000; // both answers real, round 1
  assert.equal(result.answers.find((a) => a.text === 'from p1').pointsAwarded, Math.round(pool * 2 / 3));
  assert.equal(result.answers.find((a) => a.text === 'from p2').pointsAwarded, Math.round(pool * 1 / 3));
});

test('sweeping a safety quip pays half the pool, not all of it', () => {
  const h = harness();
  const matchupId = matchupFor(h, 'p1');
  assert.equal(h.engine.handleAnswer('p1', matchupId, 'only real answer'), true);
  h.fire();

  const active = h.active();
  const human = active.answers.find((a) => a.text === 'only real answer');
  for (const voter of ['p3', 'a1', 'a2']) {
    h.engine.handleVote(voter, active.id, human.answerId);
  }
  h.finish();

  const result = h.results().find((m) => m.prompt === active.prompt);
  const humanAnswer = result.answers.find((a) => a.text === 'only real answer');
  assert.equal(
    humanAnswer.pointsAwarded,
    500,
    'a partner who timed out used to be worth a full 1000-point sweep',
  );
});

test('votes cast for the safety quip count against the human', () => {
  const h = harness();
  const matchupId = matchupFor(h, 'p1');
  assert.equal(h.engine.handleAnswer('p1', matchupId, 'real'), true);
  h.fire();

  const active = h.active();
  const human = active.answers.find((a) => a.text === 'real');
  const safety = active.answers.find((a) => a.answerId !== human.answerId);
  h.engine.handleVote('p3', active.id, human.answerId);
  h.engine.handleVote('a1', active.id, safety.answerId);
  h.engine.handleVote('a2', active.id, safety.answerId);
  h.finish();

  const result = h.results().find((m) => m.prompt === active.prompt);
  // Pool 500, one vote of three -> 167. Excluding safety votes would have paid
  // the full 500 no matter how badly the room preferred the canned line.
  assert.equal(result.answers.find((a) => a.text === 'real').pointsAwarded, 167);
});

test('writing an answer always beats letting the clock run out', () => {
  const h = harness();
  const matchupId = matchupFor(h, 'p1');
  assert.equal(h.engine.handleAnswer('p1', matchupId, 'wrote something'), true);
  h.fire();

  const active = h.active();
  // The active matchup deliberately hides authorship, so the canned line is
  // simply the answer that is not the one p1 wrote.
  const safety = active.answers.find((a) => a.text !== 'wrote something');
  // The room votes unanimously for it: p1 scores nothing on vote share, and
  // must still finish ahead of the player who submitted nothing.
  for (const voter of ['p3', 'a1', 'a2']) {
    h.engine.handleVote(voter, active.id, safety.answerId);
  }
  h.finish();

  const result = h.results().find((m) => m.prompt === active.prompt);
  const timedOut = result.answers.find((a) => a.isSafety).playerId;
  assert.equal(result.answers.find((a) => a.text === 'wrote something').pointsAwarded, 0);
  assert.ok(h.scoreOf('p1') > 0, 'submitting must never score zero');
  assert.equal(h.scoreOf(timedOut), 0);
});

test('the submit bonus is paid even for matchups nobody could vote on', () => {
  const h = harness({ audienceCount: 0 });
  const matchupId = matchupFor(h, 'p1');
  assert.equal(h.engine.handleAnswer('p1', matchupId, 'written'), true);
  // Everyone else drops, so no matchup is votable at all.
  for (const player of h.players.slice(1)) player.connected = false;
  h.fire();
  h.finish();

  assert.equal(h.scoreOf('p1'), 100, 'a round with no voters still rewards writing');
});
