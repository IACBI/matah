import assert from 'node:assert/strict';
import test from 'node:test';

import { TriviaEngine } from '../../server/src/engines/trivia.ts';
import { triviaPool } from '../../server/src/content/trivia.ts';

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
    ctx,
    engine,
    players,
    get phase() { return phase; },
    elapse(ms) { now += ms; },
    fireTimeout() { assert.ok(timeout); timeout(); },
  };
}

// The whole pool, not a sample of it: a sample only covers every question
// while the pool happens to be exactly that size.
const correctByQuestion = new Map(
  triviaPool('en').map((q) => [q.text, q.options[q.correctIndex]]),
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

test('a snapshot restores a question mid-answer with its clock and answers intact', () => {
  const h = harness(2);
  h.engine.start();
  const question = h.engine.serialize().trivia.question;
  const correct = correctIndex(h.engine);
  h.elapse(4_000);
  assert.equal(h.engine.handleTriviaAnswer('p1', question.id, correct), true);
  h.elapse(2_000);
  const saved = JSON.parse(JSON.stringify(h.engine.snapshot()));
  assert.equal(saved.type, 'trivia');

  const restored = TriviaEngine.restore(h.ctx, saved.data);
  assert.deepEqual(restored.serialize(), h.engine.serialize(), 'the public view is identical');
  assert.equal(restored.handleTriviaAnswer('p1', question.id, correct), false, 'the answer is still locked in');
  // The clock carried over: p2 answers 6 s in, not at the restart's zero.
  assert.equal(restored.handleTriviaAnswer('p2', question.id, correct), true);
  restored.timeoutHandler()();
  assert.equal(h.phase, 'results');
  // Base 500 + speed bonus over 20 s: p1 at 4 s keeps 80%, p2 at 6 s keeps 70%.
  assert.equal(h.players[0].score, 900);
  assert.equal(h.players[1].score, 850);
  assert.ok(restored.timeoutHandler(), 'the results phase re-arms too');
});
