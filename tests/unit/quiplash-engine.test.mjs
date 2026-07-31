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

function harness() {
  const players = [participant('p1'), participant('p2'), participant('p3')];
  const audience = [participant('a1', true), participant('a2', true)];
  const assignments = new Map();
  let timeout = null;
  let now = 1_000;
  const ctx = {
    language: 'en',
    players: () => players,
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
    toScoreboard: () => {},
    now: () => now,
  };
  const engine = new QuiplashEngine(ctx, 1);
  return {
    engine,
    players,
    audience,
    assignments,
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

test('votes for a safety answer do not dilute the human point pool', () => {
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
  assert.equal(result.answers.find((answer) => answer.text === 'human answer').pointsAwarded, 1_000);
  const safetyResult = result.answers.find((answer) => answer.isSafety);
  assert.equal(safetyResult.pointsAwarded, 0);
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
  assert.equal(h.engine.handleAnswer('p3', matchupId, 'answer'), false);
  assert.equal(h.engine.handleAnswer('p1', matchupId, '   '), true);
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

test('voting skips abandoned matchups and reaches results without a voter', () => {
  const h = harness();
  h.engine.start();
  h.players.forEach((member) => { member.connected = false; });
  h.audience.forEach((member) => { member.connected = false; });
  h.engine.handlePlayerDisconnect();
  h.fireTimeout();
  assert.equal(h.engine.serialize().quiplash.activeMatchup, null);
});
