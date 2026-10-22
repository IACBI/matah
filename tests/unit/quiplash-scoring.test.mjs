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

  const ctx = {
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
  };
  const engine = new QuiplashEngine(ctx, rounds);
  engine.start();

  return {
    ctx,
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

/**
 * The matchup the two named players both author (there is exactly one). Round
 * pairing is shuffled, so which matchup that is has to be looked up — and the
 * players it leaves out are the ones eligible to vote on it.
 */
function matchupFor(h, playerId, partnerId = 'p2') {
  const partner = h.assignments.get(partnerId).prompts;
  const shared = h.assignments.get(playerId).prompts
    .find((prompt) => partner.some((other) => other.matchupId === prompt.matchupId));
  assert.ok(shared, `${playerId} and ${partnerId} co-author a matchup`);
  return shared.matchupId;
}

/**
 * p1's first matchup in a seated-only room, its co-author, and the seated
 * players left free to vote on it. With five players the pairing is shuffled,
 * so the partner has to be looked up rather than assumed.
 */
function seatedMatchup(h) {
  const { matchupId } = h.assignments.get('p1').prompts[0];
  const partnerId = h.players
    .map((p) => p.id)
    .find((id) => id !== 'p1' && h.assignments.get(id)?.prompts.some((o) => o.matchupId === matchupId));
  assert.ok(partnerId, 'p1 has a co-author');
  const voters = h.players.map((p) => p.id).filter((id) => id !== 'p1' && id !== partnerId);
  return { matchupId, partnerId, voters };
}

test('two real answers split the pool by vote share', () => {
  const h = harness({ playerCount: 5, audienceCount: 0 });
  const { matchupId, partnerId, voters } = seatedMatchup(h);
  assert.equal(h.engine.handleAnswer('p1', matchupId, 'from p1'), true);
  assert.equal(h.engine.handleAnswer(partnerId, matchupId, 'from p2'), true);
  h.fire();

  const active = h.active();
  assert.equal(active.id, matchupId);
  const first = active.answers.find((a) => a.text === 'from p1');
  const second = active.answers.find((a) => a.text === 'from p2');
  // Three voters: two for p1, one for p2.
  assert.equal(h.engine.handleVote(voters[0], active.id, first.answerId), true);
  assert.equal(h.engine.handleVote(voters[1], active.id, first.answerId), true);
  assert.equal(h.engine.handleVote(voters[2], active.id, second.answerId), true);
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
  const h = harness({ playerCount: 5, audienceCount: 0 });
  const { matchupId, voters } = seatedMatchup(h);
  assert.equal(h.engine.handleAnswer('p1', matchupId, 'real'), true);
  h.fire();

  const active = h.active();
  const human = active.answers.find((a) => a.text === 'real');
  const safety = active.answers.find((a) => a.answerId !== human.answerId);
  h.engine.handleVote(voters[0], active.id, human.answerId);
  h.engine.handleVote(voters[1], active.id, safety.answerId);
  h.engine.handleVote(voters[2], active.id, safety.answerId);
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

/**
 * Two authors answer the first matchup `p1` was dealt, then its vote opens.
 * With four players, the two players who did not write it are the seated voters.
 */
function openAnsweredMatchup(h, [textOne, textTwo]) {
  const matchupId = h.assignments.get('p1').prompts[0].matchupId;
  const authors = h.players
    .filter((p) => h.assignments.get(p.id).prompts.some((x) => x.matchupId === matchupId))
    .map((p) => p.id);
  assert.equal(authors.length, 2, 'a matchup has two authors');
  h.engine.handleAnswer(authors[0], matchupId, textOne);
  h.engine.handleAnswer(authors[1], matchupId, textTwo);
  h.fire();

  const active = h.active();
  assert.equal(active.id, matchupId);
  const answerFor = (text) => active.answers.find((a) => a.text === text).answerId;
  const seatedVoters = h.players.filter((p) => !authors.includes(p.id)).map((p) => p.id);
  return { prompt: active.prompt, answerFor, seatedVoters };
}

function pointsFor(h, prompt, text) {
  const result = h.results().find((m) => m.prompt === prompt);
  return result.answers.find((a) => a.text === text);
}

test('twenty spectators cannot outvote two seated players', () => {
  const h = harness({ playerCount: 4, audienceCount: 20 });
  const { prompt, answerFor, seatedVoters } = openAnsweredMatchup(h, ['from one', 'from two']);
  const matchupId = h.active().id;
  for (const spectator of h.audience) {
    assert.equal(h.engine.handleVote(spectator.id, matchupId, answerFor('from one')), true);
  }
  for (const voter of seatedVoters) {
    assert.equal(h.engine.handleVote(voter, matchupId, answerFor('from two')), true);
  }
  h.finish();

  const one = pointsFor(h, prompt, 'from one');
  const two = pointsFor(h, prompt, 'from two');
  assert.equal(one.votes, 20, 'displayed votes stay the raw count');
  assert.equal(two.votes, 2);
  assert.ok(two.pointsAwarded > one.pointsAwarded, 'the seated pair beats the crowd');
  // The bloc weighs 1 (half of the 2 seated votes), against 2 for the seated pair.
  assert.equal(two.pointsAwarded, 667);
  assert.equal(one.pointsAwarded, 333);
});

test('audience votes alone still decide the share when no seated player voted', () => {
  const h = harness({ playerCount: 4, audienceCount: 20 });
  const { prompt, answerFor } = openAnsweredMatchup(h, ['from one', 'from two']);
  const matchupId = h.active().id;
  h.audience.slice(0, 19).forEach((spectator) => {
    h.engine.handleVote(spectator.id, matchupId, answerFor('from one'));
  });
  h.engine.handleVote(h.audience[19].id, matchupId, answerFor('from two'));
  h.finish();

  assert.equal(pointsFor(h, prompt, 'from one').pointsAwarded, 950);
  assert.equal(pointsFor(h, prompt, 'from two').pointsAwarded, 50);
});

test('one spectator tilts a split room that the seated players left even', () => {
  const h = harness({ playerCount: 4, audienceCount: 1 });
  const { prompt, answerFor, seatedVoters } = openAnsweredMatchup(h, ['from one', 'from two']);
  const matchupId = h.active().id;
  h.engine.handleVote(seatedVoters[0], matchupId, answerFor('from one'));
  h.engine.handleVote(seatedVoters[1], matchupId, answerFor('from two'));
  h.engine.handleVote(h.audience[0].id, matchupId, answerFor('from two'));
  h.finish();

  assert.equal(pointsFor(h, prompt, 'from two').pointsAwarded, 667);
  assert.equal(pointsFor(h, prompt, 'from one').pointsAwarded, 333);
});

test('audience weighting survives a restart before results', () => {
  const h = harness({ playerCount: 4, audienceCount: 20 });
  const { prompt, answerFor, seatedVoters } = openAnsweredMatchup(h, ['from one', 'from two']);
  const matchupId = h.active().id;
  for (const spectator of h.audience) {
    h.engine.handleVote(spectator.id, matchupId, answerFor('from one'));
  }
  h.engine.handleVote(seatedVoters[0], matchupId, answerFor('from two'));
  h.engine.handleVote(seatedVoters[1], matchupId, answerFor('from two'));

  const restored = QuiplashEngine.restore(h.ctx, JSON.parse(JSON.stringify(h.engine.snapshot().data)));
  for (let guard = 0; guard < 40 && !restored.serialize().quiplash.lastResults; guard += 1) {
    restored.timeoutHandler()();
  }

  const resultsAfterRestart = restored.serialize().quiplash.lastResults.find((m) => m.prompt === prompt);
  assert.equal(resultsAfterRestart.answers.find((a) => a.text === 'from two').pointsAwarded, 667);
  assert.equal(resultsAfterRestart.answers.find((a) => a.text === 'from one').pointsAwarded, 333);
});
