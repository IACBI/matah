import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BLUFF_FOOL_POINTS,
  BLUFF_TRUTH_POINTS,
  checkQuestionParts,
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

test('answerKey keeps the marks that make a Hindi or Japanese word different', () => {
  assert.notEqual(answerKey('कान'), answerKey('कौन'), 'vowel signs decide the word');
  assert.notEqual(answerKey('कल'), answerKey('कुल'));
  assert.notEqual(answerKey('ガス'), answerKey('カス'), 'dakuten is not an accent');
  assert.equal(answerKey('कान!'), answerKey('कान'), 'punctuation is still ignored');
  assert.equal(checkQuestionParts(['प्रश्न?', 'कान', 'कौन', 'नाक', 'आँख']), null);
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

test('a player who reloads during the reveal gets their own pick back', () => {
  const h = harness(2);
  h.engine.start();
  const qid = h.questionId();
  for (const [id, text] of [['p1', 'Lie one'], ['p2', 'Lie two'], ['p3', 'Lie three']]) {
    assert.equal(h.engine.handleLie(id, qid, text), null);
  }
  assert.equal(h.engine.handlePick('p1', qid, h.optionFor('Lie two')), true);
  assert.equal(h.engine.handlePick('p2', qid, h.optionFor('Lie one')), true);
  assert.equal(h.engine.handlePick('p3', qid, h.optionFor(h.truth())), true);
  assert.equal(h.phases.at(-1), 'results');

  const again = h.engine.currentAssignment('p1');
  assert.equal(again.bluff.questionId, qid);
  assert.equal(again.bluff.pickedOptionId, h.optionFor('Lie two'));
  assert.deepEqual(again.bluff.ownOptionIds, [h.optionFor('Lie one')]);
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
  assert.equal(h.players[0].score, BLUFF_FOOL_POINTS / 2, 'both authors split the fool');
  assert.equal(h.players[1].score, BLUFF_FOOL_POINTS / 2 + BLUFF_TRUTH_POINTS);
  assert.equal(h.players[2].score, BLUFF_FOOL_POINTS);
});

test('one picker fooled by a merged lie splits the fool points between its authors', () => {
  const h = harness(2);
  h.engine.start();
  const qid = h.questionId();
  h.engine.handleLie('p1', qid, 'Same Lie');
  h.engine.handleLie('p2', qid, 'same lie!');
  h.engine.handleLie('p3', qid, 'Different');
  h.engine.handlePick('p3', qid, h.optionFor('Same Lie'));
  h.engine.handlePick('p1', qid, h.optionFor(h.truth()));
  h.engine.handlePick('p2', qid, h.optionFor('Different'));
  assert.equal(h.players[0].score, BLUFF_FOOL_POINTS / 2 + BLUFF_TRUTH_POINTS, 'p1: half a fool and the truth');
  assert.equal(h.players[1].score, BLUFF_FOOL_POINTS / 2, 'p2: the other half, nothing for picking a lie');
  assert.equal(h.players[2].score, BLUFF_FOOL_POINTS, 'p3 was fooled by p2 on their own lie');

  // The fooled count is still the number of pickers, not divided by the authors.
  const merged = h.engine.highlights().find((x) => x.text === 'Same Lie');
  assert.equal(merged.votes, 1);
  assert.deepEqual(merged.authors.map((c) => c.name), ['p1', 'p2']);
});

test('each picker of a merged lie splits one fool between its authors', () => {
  const h = harness(2, ['p1', 'p2', 'p3', 'p4']);
  h.engine.start();
  const qid = h.questionId();
  h.engine.handleLie('p1', qid, 'Same Lie');
  h.engine.handleLie('p2', qid, 'Same Lie');
  h.engine.handleLie('p3', qid, 'Third');
  h.engine.handleLie('p4', qid, 'Fourth');
  const shared = h.optionFor('Same Lie');
  h.engine.handlePick('p3', qid, shared);
  h.engine.handlePick('p4', qid, shared);
  h.engine.handlePick('p1', qid, h.optionFor(h.truth()));
  h.engine.handlePick('p2', qid, h.optionFor(h.truth()));
  assert.equal(h.phases.at(-1), 'results');
  // Two pickers, each splitting a fool: every author gets half from each,
  // so the authors together collect exactly two fools, as two solo fools would.
  assert.equal(h.players[0].score, BLUFF_FOOL_POINTS / 2 * 2 + BLUFF_TRUTH_POINTS);
  assert.equal(h.players[1].score, BLUFF_FOOL_POINTS / 2 * 2 + BLUFF_TRUTH_POINTS);
  assert.equal(h.players[2].score, 0);
  assert.equal(h.players[3].score, 0);

  const [best] = h.engine.highlights();
  assert.equal(best.text, 'Same Lie');
  assert.equal(best.votes, 2, 'two pickers, counted once each');
});

test('a three-author merged lie conserves the fool points, with the remainder going to earlier authors', () => {
  const h = harness(2, ['p1', 'p2', 'p3', 'p4']);
  h.engine.start();
  const qid = h.questionId();
  h.engine.handleLie('p1', qid, 'Same Lie');
  h.engine.handleLie('p2', qid, 'same lie!');
  h.engine.handleLie('p3', qid, 'SAME LIE');
  h.engine.handleLie('p4', qid, 'Different');
  const shared = h.optionFor('Same Lie');
  h.engine.handlePick('p4', qid, shared);
  h.engine.handlePick('p1', qid, h.optionFor(h.truth()));
  h.engine.handlePick('p2', qid, h.optionFor(h.truth()));
  h.engine.handlePick('p3', qid, h.optionFor(h.truth()));
  assert.equal(h.phases.at(-1), 'results');

  // 250 over three authors is 83 each with one point left over; p1 is first.
  const fool = [h.players[0], h.players[1], h.players[2]].map((p) => p.score - BLUFF_TRUTH_POINTS);
  assert.deepEqual(fool, [84, 83, 83]);
  assert.equal(fool.reduce((sum, n) => sum + n, 0), BLUFF_FOOL_POINTS, 'no point created or lost');
  assert.equal(h.players[3].score, 0, 'picking a lie that is not yours pays nothing');
});

test('a three-author merged lie on the final question conserves the doubled fool points', () => {
  const h = harness(1, ['p1', 'p2', 'p3', 'p4']);
  h.engine.start();
  const qid = h.questionId();
  h.engine.handleLie('p1', qid, 'Same Lie');
  h.engine.handleLie('p2', qid, 'same lie!');
  h.engine.handleLie('p3', qid, 'SAME LIE');
  h.engine.handleLie('p4', qid, 'Different');
  const shared = h.optionFor('Same Lie');
  h.engine.handlePick('p4', qid, shared);
  h.engine.handlePick('p1', qid, h.optionFor(h.truth()));
  h.engine.handlePick('p2', qid, h.optionFor(h.truth()));
  h.engine.handlePick('p3', qid, h.optionFor(h.truth()));
  assert.equal(h.phases.at(-1), 'results');

  // 500 over three authors: 167, 167, 166.
  const total = BLUFF_FOOL_POINTS * TRIVIA_FINAL_MULTIPLIER;
  const fool = [h.players[0], h.players[1], h.players[2]].map(
    (p) => p.score - BLUFF_TRUTH_POINTS * TRIVIA_FINAL_MULTIPLIER,
  );
  assert.deepEqual(fool, [167, 167, 166]);
  assert.equal(fool.reduce((sum, n) => sum + n, 0), total);
});

test('a solo lie still pays its author the full fool points, doubled on the last question', () => {
  const h = harness(2);
  h.engine.start();
  const qid = h.questionId();
  h.engine.handleLie('p1', qid, 'Zorblax');
  h.engine.handleLie('p2', qid, 'Quibble');
  h.engine.handleLie('p3', qid, 'Frumpet');
  h.engine.handlePick('p2', qid, h.optionFor('Zorblax'));
  h.engine.handlePick('p1', qid, h.optionFor(h.truth()));
  h.engine.handlePick('p3', qid, h.optionFor(h.truth()));
  assert.equal(h.players[0].score, BLUFF_FOOL_POINTS + BLUFF_TRUTH_POINTS, 'the whole fool, not a share');

  const finale = harness(1);
  finale.engine.start();
  const fq = finale.questionId();
  finale.engine.handleLie('p1', fq, 'Zorblax');
  finale.engine.handleLie('p2', fq, 'Quibble');
  finale.engine.handleLie('p3', fq, 'Frumpet');
  finale.engine.handlePick('p2', fq, finale.optionFor('Zorblax'));
  finale.engine.handlePick('p1', fq, finale.optionFor(finale.truth()));
  finale.engine.handlePick('p3', fq, finale.optionFor(finale.truth()));
  assert.equal(
    finale.players[0].score,
    (BLUFF_FOOL_POINTS + BLUFF_TRUTH_POINTS) * TRIVIA_FINAL_MULTIPLIER,
    'the final multiplier applies to a solo fool',
  );
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
