import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LANGUAGES,
  MAX_OPTION_LEN,
  MAX_PLAYERS,
  MAX_QUESTION_LEN,
  MAX_ROUNDS,
} from '../../shared/src/index.ts';
import { pickPromptsForSlots, promptPool, pickSafetyAnswer } from '../../server/src/content/prompts.ts';
import {
  parseCustomQuestion,
  parseCustomQuestions,
  pickTrivia,
  triviaPool,
} from '../../server/src/content/trivia.ts';
import { answerKey } from '../../server/src/engines/bluff.ts';
import { QuiplashEngine } from '../../server/src/engines/quiplash.ts';
import { participant } from '../helpers/room.mjs';

// Minimums, not exact counts, so a language can be topped up on its own
// without every other language having to match in the same commit.
const MIN_PROMPTS = 40;
const MIN_TRIVIA = 32;
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

test('bluff can always tell a trivia answer from its wrong options', () => {
  // Bluff compares answers loosely (case, accents, punctuation), so two
  // options that only differ that way would make the truth ambiguous.
  for (const language of LANGUAGES) {
    for (const question of triviaPool(language)) {
      const keys = question.options.map(answerKey);
      assert.ok(keys.every(Boolean), `${language} has an option with no letters or digits: ${question.text}`);
      assert.equal(new Set(keys).size, keys.length, `${language} options collide loosely in: ${question.text}`);
    }
  }
});

test('custom prompts are played first, but never at the cost of the per-author rule', () => {
  const custom = ['Custom A', 'Custom B'];
  const slots = [{ authors: ['p1', 'p2'] }, { authors: ['p2', 'p3'] }, { authors: ['p3', 'p1'] }];
  const picked = pickPromptsForSlots('en', slots, new Set(), new Map(), custom);
  assert.ok(custom.every((prompt) => picked.includes(prompt)), 'both custom prompts are used');
  assert.equal(new Set(picked).size, 3, 'the third slot falls back to a built-in prompt');

  // p1 has already written for Custom A, so it cannot be handed to p1 again.
  const seen = new Map([['Custom A', new Set(['p1'])]]);
  const [first] = pickPromptsForSlots('en', [{ authors: ['p1', 'p2'] }], new Set(), seen, custom);
  assert.equal(first, 'Custom B');
});

// ---- host-written trivia packs ----

const packLine = (n) => `Question ${n}? | Right ${n} | Wrong A${n} | Wrong B${n} | Wrong C${n}`;

test('a pack line becomes a question whose right answer is the first one written', () => {
  assert.deepEqual(parseCustomQuestion(packLine(1)), {
    text: 'Question 1?',
    options: ['Right 1', 'Wrong A1', 'Wrong B1', 'Wrong C1'],
    correctIndex: 0,
  });
});

test('a pasted spreadsheet row works, and empty trailing columns are ignored', () => {
  const row = ['Capital of France?', 'Paris', 'Rome', 'Madrid', 'Berlin'];
  assert.deepEqual(parseCustomQuestion(row.join('\t')), parseCustomQuestion(row.join(' | ')));
  assert.notEqual(parseCustomQuestion(`${row.join('\t')}\t\t`), null);
  assert.notEqual(parseCustomQuestion(`${row.join(' | ')} | `), null);
});

test('a line that cannot be played is refused rather than repaired', () => {
  const refused = {
    'no answers': 'Just a question?',
    'too few wrong answers': 'Q? | Right | Wrong | Wrong',
    'too many columns': 'Q? | A | B | C | D | E',
    'a blank answer': 'Q? | Right |  | Wrong | Wrong',
    'a blank question': ' | Right | A | B | C',
    'the right answer twice': 'Q? | Paris | Rome | paris! | Berlin',
    'accents only': 'Q? | Café | Cafe | Tea | Milk',
    'an over-long question': `${'q'.repeat(MAX_QUESTION_LEN + 1)} | A | B | C | D`,
    'an over-long answer': `Q? | ${'a'.repeat(MAX_OPTION_LEN + 1)} | B | C | D`,
  };
  for (const [label, line] of Object.entries(refused)) {
    assert.equal(parseCustomQuestion(line), null, label);
  }
  for (const value of [undefined, null, 42, {}, ['a']]) {
    assert.equal(parseCustomQuestion(value), null, String(value));
  }
});

test('the length limits are inclusive, and count code points rather than UTF-16 units', () => {
  const question = '𠮷'.repeat(MAX_QUESTION_LEN);
  const option = (letter) => `${letter}${'𠮷'.repeat(MAX_OPTION_LEN - 1)}`;
  const line = [question, option('a'), option('b'), option('c'), option('d')].join(' | ');
  assert.equal(parseCustomQuestion(line)?.text, question);
});

test('answers made only of symbols stay distinct from one another', () => {
  const question = parseCustomQuestion('Which is bigger than 5? | > | < | = | ≠');
  assert.deepEqual(question?.options, ['>', '<', '=', '≠']);
  assert.equal(parseCustomQuestion('Q? | ∞ | ∞ | a | b'), null, 'the same symbol twice is still a repeat');
});

test('pack text is sanitized like any other user text', () => {
  const zwj = '\u200D';
  const question = parseCustomQuestion(`Who\u202E wrote\u0007 it? | 👩${zwj}💻 | A\u200Bb | C | D`);
  assert.equal(question?.text, 'Who wrote it?', 'bidi and control characters are gone');
  assert.equal(question?.options[0], `👩${zwj}💻`, 'an emoji sequence survives');
  assert.equal(question?.options[1], 'Ab', 'a zero-width space is gone');
});

test('a pack keeps its order and drops blanks, repeats and unplayable lines', () => {
  const questions = parseCustomQuestions([
    packLine(1),
    '',
    'not a question',
    packLine(2),
    packLine(1).replace('Right 1', 'Something else'),
    'QUESTION 2? | x | y | z | w',
    packLine(3),
  ]);
  assert.deepEqual(questions.map((q) => q.text), ['Question 1?', 'Question 2?', 'Question 3?']);
});

test('trivia plays the host\'s questions first and fills the rest from the built-in pool', () => {
  const custom = parseCustomQuestions([packLine(1), packLine(2)]);
  const picked = pickTrivia('en', 5, new Set(), custom);
  assert.equal(picked.length, 5);
  assert.deepEqual(new Set(picked.slice(0, 2).map((q) => q.text)), new Set(custom.map((q) => q.text)));
  const builtIn = new Set(triviaPool('en').map((q) => q.text));
  assert.ok(picked.slice(2).every((q) => builtIn.has(q.text)), 'the remainder is built in');
  assert.equal(new Set(picked.map((q) => q.text)).size, 5, 'no question twice');
});

test('a game shorter than the pack plays a subset, and never invents questions', () => {
  const custom = parseCustomQuestions([1, 2, 3, 4].map(packLine));
  const picked = pickTrivia('en', 2, new Set(), custom);
  assert.equal(picked.length, 2);
  assert.ok(picked.every((q) => custom.some((c) => c.text === q.text)), 'only the host\'s own');
});

test('a rematch prefers pack questions it has not shown yet', () => {
  const custom = parseCustomQuestions([1, 2, 3, 4].map(packLine));
  const first = pickTrivia('en', 2, new Set(), custom).map((q) => q.text);
  const second = pickTrivia('en', 2, new Set(first), custom).map((q) => q.text);
  assert.equal(second.filter((text) => first.includes(text)).length, 0);
});
