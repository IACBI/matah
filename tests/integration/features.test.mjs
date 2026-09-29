import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import {
  MAX_CUSTOM_PROMPTS,
  MAX_CUSTOM_QUESTIONS,
  MAX_OPTION_LEN,
  MAX_PROMPT_LEN,
  MAX_QUESTION_LEN,
} from '../../shared/src/index.ts';
import { clients } from '../helpers/socket.mjs';

// Same address for every socket; see room-flows.test.mjs.
process.env.MATAH_RL_CREATE = '500';
process.env.MATAH_RL_ACTION_BURST = '5000';
process.env.MATAH_RL_ROOMS_PER_IP = '500';
const { startServer, stopServer } = await import('../../server/src/index.ts');

let baseUrl;
const { ack, once, until, createRoomWithPlayers, disconnectAll } = clients(() => baseUrl);

before(async () => {
  const port = await startServer(0);
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  disconnectAll();
  await stopServer();
});

test('the host pauses a game, submissions wait, and resume picks up', async () => {
  const room = await createRoomWithPlayers(3);
  const playing = until(room.host, (s) => s.phase === 'answering', 'trivia question');
  assert.deepEqual(
    await ack(room.host, 'game:start', { gameType: 'trivia', rounds: 3, phaseId: room.state.phaseId }),
    { ok: true, data: null },
  );
  const question = (await playing).trivia.question;

  assert.deepEqual(
    await ack(room.members[0].socket, 'game:pause', { phaseId: room.state.phaseId }),
    { ok: false, error: 'host_only' },
    'a player cannot freeze everyone else',
  );
  const frozen = until(room.host, (s) => s.pausedRemainingMs !== null, 'paused state');
  assert.deepEqual(await ack(room.host, 'game:pause', { phaseId: room.state.phaseId }), { ok: true, data: null });
  const paused = await frozen;
  assert.equal(paused.phaseEndsAt, null);
  assert.ok(paused.pausedRemainingMs > 15_000 && paused.pausedRemainingMs <= 20_000);

  assert.deepEqual(
    await ack(room.members[0].socket, 'trivia:answer', { questionId: question.id, optionIndex: 0 }),
    { ok: false, error: 'game_paused' },
  );

  const running = until(room.host, (s) => s.pausedRemainingMs === null && s.phaseEndsAt !== null, 'resumed');
  assert.deepEqual(await ack(room.host, 'game:resume', { phaseId: room.state.phaseId }), { ok: true, data: null });
  await running;
  assert.deepEqual(
    await ack(room.members[0].socket, 'trivia:answer', { questionId: question.id, optionIndex: 0 }),
    { ok: true, data: null },
  );
});

test('the host moves players between seats and the audience in the lobby', async () => {
  const room = await createRoomWithPlayers(4);
  const target = room.members[3].session.playerId;
  assert.deepEqual(
    await ack(room.members[0].socket, 'player:setSeat', { playerId: target, audience: true, phaseId: room.state.phaseId }),
    { ok: false, error: 'host_only' },
  );
  const benched = until(room.host, (s) => s.audience.some((a) => a.id === target), 'benched');
  assert.deepEqual(
    await ack(room.host, 'player:setSeat', { playerId: target, audience: true, phaseId: room.state.phaseId }),
    { ok: true, data: null },
  );
  assert.equal((await benched).players.length, 3);
  assert.deepEqual(
    await ack(room.host, 'player:setSeat', { playerId: target, audience: 'yes', phaseId: room.state.phaseId }),
    { ok: false, error: 'invalid_target' },
    'the flag must be a real boolean',
  );
});

test('custom prompt packs are host-only, bounded, and reported as a count', async () => {
  const room = await createRoomWithPlayers(3);
  assert.deepEqual(
    await ack(room.members[0].socket, 'room:setCustomPrompts', { prompts: ['x'], phaseId: room.state.phaseId }),
    { ok: false, error: 'host_only' },
  );
  // A full pack of the longest multi-byte prompts must fit in one frame.
  const pack = Array.from({ length: MAX_CUSTOM_PROMPTS }, (_, i) => `${i} ${'玩'.repeat(MAX_PROMPT_LEN)}`);
  const counted = until(room.host, (s) => s.customPromptCount === MAX_CUSTOM_PROMPTS, 'custom count');
  assert.deepEqual(
    await ack(room.host, 'room:setCustomPrompts', { prompts: pack, phaseId: room.state.phaseId }),
    { ok: true, data: { count: MAX_CUSTOM_PROMPTS } },
  );
  await counted;
  assert.deepEqual(
    await ack(room.host, 'room:setCustomPrompts', {
      prompts: [...pack, 'one too many'],
      phaseId: room.state.phaseId,
    }),
    { ok: false, error: 'invalid_prompts' },
  );
});

test('a bluff question runs end to end over sockets', async () => {
  const room = await createRoomWithPlayers(3);
  const writing = until(room.host, (s) => s.phase === 'answering' && s.bluff?.question, 'bluff question');
  assert.deepEqual(
    await ack(room.host, 'game:start', { gameType: 'bluff', rounds: 2, phaseId: room.state.phaseId }),
    { ok: true, data: null },
  );
  const { question } = (await writing).bluff;

  const picking = until(room.host, (s) => s.phase === 'voting' && s.bluff?.options, 'bluff options');
  const assignments = room.members.map(({ socket }) =>
    new Promise((resolve) => {
      const onAssignment = (assignment) => {
        if (assignment.bluff?.ownOptionIds.length) {
          socket.off('player:assignment', onAssignment);
          resolve(assignment);
        }
      };
      socket.on('player:assignment', onAssignment);
    }),
  );
  for (const [index, { socket }] of room.members.entries()) {
    assert.deepEqual(
      await ack(socket, 'bluff:lie', { questionId: question.id, text: `Invented answer ${index}` }),
      { ok: true, data: null },
    );
  }
  const { options } = (await picking).bluff;
  assert.equal(options.length, 4);
  const own = (await Promise.all(assignments)).map((a) => a.bluff.ownOptionIds[0]);

  assert.deepEqual(
    await ack(room.members[0].socket, 'bluff:pick', { questionId: question.id, optionId: own[0] }),
    { ok: false, error: 'vote_failed' },
    'your own lie is not a choice',
  );
  const revealed = until(room.host, (s) => s.phase === 'results' && s.bluff?.reveal, 'bluff reveal');
  for (const [index, { socket }] of room.members.entries()) {
    const choice = options.find((o) => !own.includes(o.optionId)) ?? options.find((o) => o.optionId !== own[index]);
    assert.deepEqual(
      await ack(socket, 'bluff:pick', { questionId: question.id, optionId: choice.optionId }),
      { ok: true, data: null },
    );
  }
  const { reveal } = (await revealed).bluff;
  const truth = reveal.options.find((o) => o.isTruth);
  assert.equal(truth.pickers.length, 3, 'the only option nobody wrote is the truth');
  assert.ok(reveal.pointsThisRound.every((p) => p.points > 0));
});

test('writing the real answer in bluff is refused with its own error', async () => {
  const room = await createRoomWithPlayers(3);
  const writing = until(room.host, (s) => s.phase === 'answering' && s.bluff?.question, 'bluff question');
  await ack(room.host, 'game:start', { gameType: 'bluff', rounds: 2, phaseId: room.state.phaseId });
  const { question } = (await writing).bluff;
  // Try every option the trivia pool offers for this question: one is true.
  const { triviaPool } = await import('../../server/src/content/trivia.ts');
  const source = triviaPool('en').find((q) => q.text === question.text);
  const truth = source.options[source.correctIndex];
  assert.deepEqual(
    await ack(room.members[0].socket, 'bluff:lie', { questionId: question.id, text: truth.toLowerCase() }),
    { ok: false, error: 'answer_is_truth' },
  );
});

test('a finished game shows highlights and session totals to everyone', async () => {
  const room = await createRoomWithPlayers(3);
  const started = until(room.host, (s) => s.phase === 'answering', 'quiplash answering');
  const prompts = room.members.map(({ socket }) => once(socket, 'player:assignment'));
  await ack(room.host, 'game:start', { gameType: 'quiplash', rounds: 1, phaseId: room.state.phaseId });
  await started;
  const voting = until(room.host, (s) => s.phase === 'voting' && s.quiplash?.activeMatchup, 'voting');
  for (const [index, assignment] of (await Promise.all(prompts)).entries()) {
    for (const prompt of assignment.prompts) {
      await ack(room.members[index].socket, 'answer:submit', {
        matchupId: prompt.matchupId,
        text: `Answer ${index} ${prompt.matchupId.slice(0, 4)}`,
      });
    }
  }
  let state = await voting;
  // One matchup at a time: everyone who may vote picks the first answer.
  while (state.phase === 'voting') {
    const matchup = state.quiplash.activeMatchup;
    if (matchup) {
      const moved = until(room.host, (s) => s.phase !== 'voting' || s.quiplash?.activeMatchup?.id !== matchup.id, 'next matchup', 10_000);
      for (const { socket } of room.members) {
        await ack(socket, 'vote:submit', { matchupId: matchup.id, answerId: matchup.answers[0].answerId });
      }
      state = await moved;
    } else {
      state = await until(room.host, (s) => s.phase !== 'voting' || s.quiplash?.activeMatchup, 'matchup', 10_000);
    }
  }
  assert.equal(state.phase, 'results');
  const answer = state.quiplash.lastResults[0].answers.find((a) => a.votes > 0);
  assert.equal(answer.voters.length, answer.votes);

  const scoreboard = until(room.members[0].socket, (s) => s.phase === 'scoreboard', 'scoreboard');
  await ack(room.host, 'game:next', { phaseId: state.phaseId });
  const final = await scoreboard;
  assert.equal(final.gamesPlayed, 1);
  assert.ok(final.highlights.length > 0);
  assert.equal(
    final.players.reduce((sum, p) => sum + p.sessionScore, 0),
    final.players.reduce((sum, p) => sum + p.score, 0),
    'the first game banks every point',
  );
});

test('custom trivia packs are host-only, fit one frame at their largest, and are played first', async () => {
  const room = await createRoomWithPlayers(3);
  const simple = (n) => `Custom question ${n}? | Right ${n} | Wrong A${n} | Wrong B${n} | Wrong C${n}`;
  assert.deepEqual(
    await ack(room.members[0].socket, 'room:setCustomQuestions', {
      questions: [simple(1)],
      phaseId: room.state.phaseId,
    }),
    { ok: false, error: 'host_only' },
  );

  // Four bytes a character, every column at its limit, the most lines allowed.
  const heavy = Array.from({ length: MAX_CUSTOM_QUESTIONS }, (_, i) =>
    [
      `${String(i).padStart(2, '0')}${'𠮷'.repeat(MAX_QUESTION_LEN - 2)}`,
      ...['a', 'b', 'c', 'd'].map((letter) => `${letter}${'𠮷'.repeat(MAX_OPTION_LEN - 1)}`),
    ].join(' | '),
  );
  const counted = until(room.host, (s) => s.customQuestionCount === MAX_CUSTOM_QUESTIONS, 'full pack');
  assert.deepEqual(
    await ack(room.host, 'room:setCustomQuestions', { questions: heavy, phaseId: room.state.phaseId }),
    { ok: true, data: { count: MAX_CUSTOM_QUESTIONS } },
  );
  await counted;
  assert.deepEqual(
    await ack(room.host, 'room:setCustomQuestions', {
      questions: [...heavy, simple(99)],
      phaseId: room.state.phaseId,
    }),
    { ok: false, error: 'invalid_questions' },
  );

  // A pack costs five tokens of the socket's own bucket; let it refill.
  await new Promise((resolve) => setTimeout(resolve, 700));
  const cleared = until(room.host, (s) => s.customQuestionCount === 2, 'two questions');
  assert.deepEqual(
    await ack(room.host, 'room:setCustomQuestions', {
      questions: [simple(1), simple(2)],
      phaseId: room.state.phaseId,
    }),
    { ok: true, data: { count: 2 } },
  );
  await cleared;

  const asking = until(room.host, (s) => s.phase === 'answering' && s.trivia?.question, 'first question');
  assert.deepEqual(
    await ack(room.host, 'game:start', { gameType: 'trivia', rounds: 3, phaseId: room.state.phaseId }),
    { ok: true, data: null },
  );
  const { question } = (await asking).trivia;
  const number = /^Custom question (\d)\?$/.exec(question.text)?.[1];
  assert.ok(number, `the first question should be the host's own, got: ${question.text}`);
  assert.deepEqual([...question.options].sort(), [`Right ${number}`, `Wrong A${number}`, `Wrong B${number}`, `Wrong C${number}`]);

  const revealed = until(room.host, (s) => s.trivia?.reveal, 'reveal');
  assert.deepEqual(
    await ack(room.host, 'game:next', { phaseId: (await room.state).phaseId }),
    { ok: true, data: null },
  );
  const { reveal } = (await revealed).trivia;
  assert.equal(question.options[reveal.correctIndex], `Right ${number}`);
});
