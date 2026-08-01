import assert from 'node:assert/strict';
import test from 'node:test';

import { LANGUAGES, MAX_PLAYERS, MAX_ROUNDS } from '../../shared/src/index.ts';
import { pickPromptsForSlots, promptPool, pickSafetyAnswer } from '../../server/src/content/prompts.ts';
import { pickTrivia, triviaPool } from '../../server/src/content/trivia.ts';
import { QuiplashEngine } from '../../server/src/engines/quiplash.ts';
import { participant } from '../helpers/room.mjs';

// Minimums, not exact counts, so a language can be topped up on its own
// without every other language having to match in the same commit.
const MIN_PROMPTS = 28;
const MIN_TRIVIA = 20;
const TRIVIA_OPTIONS = 4;

const wellFormed = (value) =>
  typeof value === 'string' && value.length > 0 && value.trim() === value;

test('every language ships a complete, well-formed prompt pool', () => {
  for (const language of LANGUAGES) {
    const pool = promptPool(language);
    assert.ok(pool.length >= MIN_PROMPTS, `${language} has only ${pool.length} prompts`);
    assert.equal(new Set(pool).size, pool.length, `${language} repeats a prompt`);
    for (const prompt of pool) {
      assert.ok(wellFormed(prompt), `${language} has a blank or untrimmed prompt`);
    }
    // Safety quips are shown under a real player's name, so they must exist.
    assert.ok(wellFormed(pickSafetyAnswer(language)), `${language} has no safety quip`);
  }
});

test('every language ships a complete, well-formed trivia pool', () => {
  for (const language of LANGUAGES) {
    const pool = triviaPool(language);
    assert.ok(pool.length >= MIN_TRIVIA, `${language} has only ${pool.length} questions`);
    assert.equal(
      new Set(pool.map((q) => q.text)).size,
      pool.length,
      `${language} repeats a question`,
    );
    for (const question of pool) {
      assert.ok(wellFormed(question.text), `${language} has a blank question`);
      assert.equal(question.options.length, TRIVIA_OPTIONS, `${language}: ${question.text}`);
      assert.equal(
        new Set(question.options).size,
        TRIVIA_OPTIONS,
        `${language} repeats an option in: ${question.text}`,
      );
      for (const option of question.options) {
        assert.ok(wellFormed(option), `${language} has a blank option in: ${question.text}`);
      }
      assert.ok(
        Number.isInteger(question.correctIndex) &&
          question.correctIndex >= 0 &&
          question.correctIndex < TRIVIA_OPTIONS,
        `${language} has an out-of-range answer for: ${question.text}`,
      );
    }
  }
});

test('an unknown language falls back to English rather than throwing', () => {
  assert.equal(pickTrivia('kl', 3).length, 3);
  assert.equal(pickPromptsForSlots('kl', [{ authors: ['p1', 'p2'] }], new Set(), new Map()).length, 1);
});

test('no player is ever handed a prompt they have already written for', () => {
  // The worst case the game allows: the largest room over the longest game.
  const players = Array.from({ length: MAX_PLAYERS }, (_, i) => participant(`p${i + 1}`));
  const written = new Map(players.map((p) => [p.id, new Set()]));
  let timeout = null;

  const engine = new QuiplashEngine({
    language: 'en',
    players: () => players,
    connectedPlayers: () => players,
    audience: () => [],
    getPlayer: (id) => players.find((p) => p.id === id),
    getParticipant: (id) => players.find((p) => p.id === id),
    setPhase: (_phase, _seconds, next) => { timeout = next; },
    emit: () => {},
    sendAssignment: (playerId, assignment) => {
      for (const { prompt } of assignment.prompts) {
        assert.equal(
          written.get(playerId).has(prompt),
          false,
          `${playerId} was asked to answer "${prompt}" twice in one game`,
        );
        written.get(playerId).add(prompt);
      }
    },
    award: () => {},
    resetFlags: () => {
      for (const player of players) {
        player.hasSubmitted = false;
        player.hasVoted = false;
      }
    },
    toScoreboard: () => {},
    now: () => 1_000,
  }, MAX_ROUNDS);

  engine.start();
  // Drive answering -> voting -> ... -> results -> next round, MAX_ROUNDS times.
  for (let step = 0; step < 200 && timeout; step += 1) {
    const pending = timeout;
    timeout = null;
    pending();
  }

  const seen = [...written.values()].map((set) => set.size);
  assert.deepEqual(
    seen,
    Array.from({ length: MAX_PLAYERS }, () => MAX_ROUNDS * 2),
    'every player should author exactly two prompts per round',
  );
});
