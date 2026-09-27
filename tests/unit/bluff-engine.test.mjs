import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BLUFF_FOOL_POINTS,
  BLUFF_TRUTH_POINTS,
  TRIVIA_FINAL_MULTIPLIER,
} from '../../shared/src/index.ts';
import { answerKey, BluffEngine } from '../../server/src/engines/bluff.ts';
import { participant } from '../helpers/room.mjs';

function harness(questions = 2, ids = ['p1', 'p2', 'p3']) {
  const players = ids.map((id) => participant(id));
  const audience = [participant('a1', { isAudience: true })];
  const assignments = new Map();
  const phases = [];
  let timeout = null;
  let now = 1_000;
  const ctx = {
    language: 'en',
    players: () => players,
    connectedPlayers: () => players.filter((p) => p.connected),
    audience: () => audience,
    getPlayer: (id) => players.find((p) => p.id === id),
    getParticipant: (id) => [...players, ...audience].find((p) => p.id === id),
    setPhase: (phase, _seconds, next) => { phases.push(phase); timeout = next; },
    emit: () => {},
    sendAssignment: (id, assignment) => assignments.set(id, assignment),
    award: (id, points) => { players.find((p) => p.id === id).score += points; },
    resetFlags: () => {
      for (const person of [...players, ...audience]) {
        person.hasSubmitted = false;
        person.hasVoted = false;
      }
    },
    toScoreboard: () => phases.push('scoreboard'),
    now: () => now,
  };
  const engine = new BluffEngine(ctx, questions);
  return {
    ctx,
    engine,
    players,
    assignments,
    phases,
    fireTimeout() { assert.ok(timeout, 'expected a pending phase timer'); const run = timeout; timeout = null; run(); },
    elapse(ms) { now += ms; },
    // The truth is hidden from every public channel by design; tests reach in.
    truth() { return engine.questions[engine.index].truth; },
    questionId() { return engine.serialize().bluff.question.id; },
    optionFor(text) {
      return engine.serialize().bluff.options.find((o) => o.text === text).optionId;
    },
  };
}

test('answerKey ignores case, accents, spacing and punctuation', () => {
  assert.equal(answerKey('  Café!! '), answerKey('cafe'));
  assert.equal(answerKey('Leonardo da Vinci'), answerKey('leonardo-da-vinci.'));
  assert.notEqual(answerKey('Mars'), answerKey('Venus'));
});

test('writing the real answer is refused and tells the player why', () => {
  const h = harness();
  h.engine.start();
  const truth = h.truth();
  assert.equal(h.engine.handleLie('p1', h.questionId(), ` ${truth.toUpperCase()}! `), 'answer_is_truth');
  assert.equal(h.players[0].hasSubmitted, false, 'a refused lie does not count as submitted');
  assert.equal(h.engine.handleLie('p1', h.questionId(), 'a clever lie'), null);
  assert.equal(h.engine.handleLie('p1', h.questionId(), 'a second lie'), 'submit_failed');
  assert.equal(h.engine.handleLie('p2', 'wrong-question', 'lie'), 'submit_failed');
  assert.equal(h.engine.handleLie('a1', h.questionId(), 'audience lie'), 'submit_failed');
});

test('a full question scores the truth-finders and every fool, doubled on the last', () => {
  const h = harness(1);
  h.engine.start();
  const qid = h.questionId();
  assert.equal(h.engine.handleLie('p1', qid, 'Lie one'), null);
  assert.equal(h.engine.handleLie('p2', qid, 'Lie two'), null);
  assert.equal(h.engine.handleLie('p3', qid, 'Lie three'), null);
  assert.deepEqual(h.phases, ['answering', 'voting'], 'all lies in moves straight to picking');

  const view = h.engine.serialize().bluff;
  assert.equal(view.options.length, 4, 'the truth plus three lies');
  assert.ok(view.options.some((o) => o.text === h.truth()));
  assert.equal(view.reveal, null, 'nothing is revealed while picking');

  // Each player learns privately which option is their own.
  const own = h.assignments.get('p1').bluff.ownOptionIds;
  assert.deepEqual(own, [h.optionFor('Lie one')]);
  assert.equal(h.engine.handlePick('p1', qid, own[0]), false, 'nobody may pick their own lie');

  assert.equal(h.engine.handlePick('p1', qid, h.optionFor('Lie two')), true);
  assert.equal(h.assignments.get('p1').bluff.pickedOptionId, h.optionFor('Lie two'), 'told privately');
  assert.equal(h.engine.handlePick('p2', qid, h.optionFor('Lie one')), true);
  assert.equal(h.engine.handlePick('p1', qid, h.optionFor(h.truth())), false, 'one pick each');
  assert.equal(h.engine.handlePick('p3', qid, h.optionFor(h.truth())), true);
  assert.equal(h.phases.at(-1), 'results');

  const last = TRIVIA_FINAL_MULTIPLIER;
  assert.equal(h.players[0].score, BLUFF_FOOL_POINTS * last, 'p1 fooled p2');
  assert.equal(h.players[1].score, BLUFF_FOOL_POINTS * last, 'p2 fooled p1');
  assert.equal(h.players[2].score, BLUFF_TRUTH_POINTS * last, 'p3 found the truth');

  const reveal = h.engine.serialize().bluff.reveal;
  const truth = reveal.options.find((o) => o.isTruth);
  assert.deepEqual(truth.pickers.map((c) => c.name), ['p3']);
  assert.deepEqual(truth.authors, []);
  const lieOne = reveal.options.find((o) => o.text === 'Lie one');
  assert.deepEqual(lieOne.authors.map((c) => c.name), ['p1']);
  assert.deepEqual(lieOne.pickers.map((c) => c.name), ['p2']);

  const [best] = h.engine.highlights();
  assert.equal(best.kind, 'lie');
  assert.equal(best.votes, 1);

  h.fireTimeout();
  assert.equal(h.phases.at(-1), 'scoreboard');
});

test('identical lies merge into one option credited to both authors', () => {
  const h = harness(2);
  h.engine.start();
  const qid = h.questionId();
  h.engine.handleLie('p1', qid, 'Same Lie');
  h.engine.handleLie('p2', qid, 'same lie!');
  h.engine.handleLie('p3', qid, 'Different');
  const options = h.engine.serialize().bluff.options;
  assert.equal(options.length, 3, 'truth, the shared lie and the other lie');
  const shared = options.find((o) => answerKey(o.text) === answerKey('same lie'));
  assert.deepEqual(h.assignments.get('p1').bluff.ownOptionIds, [shared.optionId]);
  assert.deepEqual(h.assignments.get('p2').bluff.ownOptionIds, [shared.optionId]);

  h.engine.handlePick('p3', qid, shared.optionId);
  h.engine.handlePick('p1', qid, h.optionFor('Different'));
  h.engine.handlePick('p2', qid, h.optionFor(h.truth()));
  assert.equal(h.players[0].score, BLUFF_FOOL_POINTS, 'both authors share the fool');
  assert.equal(h.players[1].score, BLUFF_FOOL_POINTS + BLUFF_TRUTH_POINTS);
  assert.equal(h.players[2].score, BLUFF_FOOL_POINTS);
});

test('a question nobody lied on is topped up with house decoys', () => {
  const h = harness(2);
  h.engine.start();
  h.fireTimeout();
  const options = h.engine.serialize().bluff.options;
  assert.equal(options.length, 3, 'the truth and two decoys from the trivia pool');
  assert.equal(new Set(options.map((o) => answerKey(o.text))).size, 3, 'no duplicates');
  // Nobody can be fooled by the house, so picking a decoy scores nothing.
  const decoy = options.find((o) => o.text !== h.truth());
  h.engine.handlePick('p1', h.questionId(), decoy.optionId);
  h.fireTimeout();
  assert.ok(h.players.every((p) => p.score === 0));
});

test('a kicked author leaves their lie behind as a pointless decoy', () => {
  const h = harness(2);
  h.engine.start();
  const qid = h.questionId();
  h.engine.handleLie('p1', qid, 'Kicked lie');
  h.engine.handleLie('p2', qid, 'Kept lie');
  h.engine.handleLie('p3', qid, 'Third lie');
  const kicked = h.optionFor('Kicked lie');
  h.players.splice(0, 1);
  h.engine.handlePlayerRemoved('p1');
  h.engine.handlePick('p2', qid, kicked);
  h.engine.handlePick('p3', qid, h.optionFor(h.truth()));
  assert.equal(h.phases.at(-1), 'results', 'the remaining pickers finish the question');
  const option = h.engine.serialize().bluff.reveal.options.find((o) => o.optionId === kicked);
  assert.deepEqual(option.authors, []);
});

test('a snapshot restores mid-pick and the game carries on', () => {
  const h = harness(2);
  h.engine.start();
  const qid = h.questionId();
  h.engine.handleLie('p1', qid, 'Lie one');
  h.engine.handleLie('p2', qid, 'Lie two');
  h.engine.handleLie('p3', qid, 'Lie three');
  h.engine.handlePick('p1', qid, h.optionFor('Lie two'));
  const saved = JSON.parse(JSON.stringify(h.engine.snapshot()));
  assert.equal(saved.type, 'bluff');

  const restored = BluffEngine.restore(h.ctx, saved.data);
  const view = restored.serialize().bluff;
  assert.deepEqual(view, h.engine.serialize().bluff, 'the public view is identical');
  assert.equal(restored.currentAssignment('p1').bluff.pickedOptionId, h.optionFor('Lie two'));
  assert.equal(restored.handlePick('p1', qid, h.optionFor('Lie three')), false, 'picks survive');
  assert.ok(restored.timeoutHandler(), 'the room gets a callback to re-arm');
  assert.equal(restored.handlePick('p2', qid, h.optionFor('Lie one')), true);
  assert.equal(restored.handlePick('p3', qid, h.optionFor('Lie two')), true);
  assert.equal(h.phases.at(-1), 'results');
  assert.equal(h.players[1].score, BLUFF_FOOL_POINTS * 2, 'p2 fooled p1 and p3');
});
