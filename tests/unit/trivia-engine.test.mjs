import assert from 'node:assert/strict';
import test from 'node:test';

import { TriviaEngine } from '../../server/src/engines/trivia.ts';
import { pickTrivia } from '../../server/src/content/trivia.ts';

function player(id) {
  return {
    id,
    name: id,
    avatar: 'fox',
    score: 0,
    connected: true,
    isHost: false,
    isAudience: false,
    hasSubmitted: false,
    hasVoted: false,
    streak: 0,
  };
}

function harness(questionCount = 3) {
  const players = [player('p1'), player('p2'), player('p3')];
  let now = 10_000;
  let timeout = null;
  let phase = null;
  const ctx = {
    language: 'en',
    players: () => players,
    audience: () => [],
    getPlayer: (id) => players.find((p) => p.id === id),
    getParticipant: (id) => players.find((p) => p.id === id),
    setPhase: (nextPhase, _seconds, nextTimeout) => {
      phase = nextPhase;
      timeout = nextTimeout;
    },
    emit: () => {},
    sendAssignment: () => {},
    award: (id, points) => {
      players.find((p) => p.id === id).score += points;
    },
    resetFlags: () => {
      for (const p of players) {
        p.hasSubmitted = false;
        p.hasVoted = false;
      }
    },
    toScoreboard: () => {
      phase = 'scoreboard';
    },
    now: () => now,
  };
  const engine = new TriviaEngine(ctx, questionCount);
  return {
    engine,
    players,
    get phase() { return phase; },
    elapse(ms) { now += ms; },
    fireTimeout() { assert.ok(timeout); timeout(); },
  };
}

const correctByQuestion = new Map(
  pickTrivia('en', 20).map((q) => [q.text, q.options[q.correctIndex]]),
);

function correctIndex(engine) {
  const question = engine.serialize().trivia.question;
  return question.options.indexOf(correctByQuestion.get(question.text));
}

test('trivia accepts only integer option indexes and locks the first answer', () => {
  const h = harness();
  h.engine.start();
  const question = h.engine.serialize().trivia.question;

  assert.equal(h.engine.handleTriviaAnswer('p1', question.id, '0'), false);
  assert.equal(h.engine.handleTriviaAnswer('p1', question.id, null), false);
  assert.equal(h.engine.handleTriviaAnswer('p1', question.id, true), false);
  assert.equal(h.players[0].hasSubmitted, false);
  assert.equal(h.engine.handleTriviaAnswer('p1', question.id, 0), true);
  assert.equal(h.engine.handleTriviaAnswer('p1', question.id, 1), false);
});

test('trivia clamps time, resets streaks, and doubles the final question', () => {
  const h = harness(2);
  h.engine.start();

  let question = h.engine.serialize().trivia.question;
  const firstCorrect = correctIndex(h.engine);
  assert.equal(h.engine.handleTriviaAnswer('p1', question.id, firstCorrect), true);
  assert.equal(h.engine.handleTriviaAnswer('p2', question.id, (firstCorrect + 1) % 4), true);
  h.fireTimeout();
  assert.equal(h.phase, 'results');
  assert.equal(h.players[0].score, 1_000);
  assert.equal(h.players[0].streak, 1);
  assert.equal(h.players[1].streak, 0);

  h.fireTimeout();
  question = h.engine.serialize().trivia.question;
  h.elapse(99_000);
  assert.equal(h.engine.handleTriviaAnswer('p1', question.id, correctIndex(h.engine)), true);
  h.fireTimeout();
  assert.equal(h.players[0].score, 2_200, '500 base + 100 streak, doubled on final');
  assert.equal(h.players[1].streak, 0, 'an unanswered player loses their streak');
});

test('trivia rejects stale identities and cannot fast-forward an abandoned room', () => {
  const h = harness(1);
  assert.equal(h.engine.handleTriviaAnswer('p1', 'missing', 0), false);
  h.engine.start();
  const question = h.engine.serialize().trivia.question;
  assert.equal(h.engine.handleTriviaAnswer('p1', 'stale', 0), false);
  assert.equal(h.engine.handleTriviaAnswer('ghost', question.id, 0), false);
  assert.equal(h.engine.handleTriviaAnswer('p1', question.id, -1), false);
  assert.equal(h.engine.handleTriviaAnswer('p1', question.id, question.options.length), false);

  h.players.forEach((member) => { member.connected = false; });
  h.engine.handlePlayerDisconnect();
  assert.equal(h.phase, 'answering');
  h.fireTimeout();
  assert.equal(h.engine.handleTriviaAnswer('p1', question.id, 0), false);
  h.engine.dispose();
});
