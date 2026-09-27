import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitAck = vi.fn();
vi.mock('../socket', () => ({
  socket: { on: vi.fn(), off: vi.fn() },
  emitAck: (...args: unknown[]) => emitAck(...args),
}));
vi.mock('../sound', () => ({
  playSfx: vi.fn(),
  haptic: vi.fn(),
  setMuted: vi.fn(),
  isMuted: vi.fn(() => false),
}));

import type { BluffView, PlayerAssignment, RoomState } from '../../../shared/src/index';
import { PlayerScreen } from '../views/PlayerScreen';
import { player, renderApp, roomState } from './helpers';

const ME = 'me';
const QUESTION = { id: 'q1', text: 'What is the capital of Canada?' };

function renderPlayer(state: RoomState, assignment: PlayerAssignment | null = null) {
  return renderApp(
    <PlayerScreen
      code="ABCD"
      myPlayerId={ME}
      state={state}
      assignment={assignment}
      secondsLeft={null}
      connected
      leaving={false}
      onLeave={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

function bluffState(phase: RoomState['phase'], bluff: Partial<BluffView>, overrides: Partial<RoomState> = {}) {
  return roomState({
    phase,
    gameType: 'bluff',
    players: [player(ME), player('p2'), player('p3')],
    bluff: { questionIndex: 0, totalQuestions: 4, question: QUESTION, options: null, reveal: null, ...bluff },
    ...overrides,
  });
}

const OPTIONS = [
  { optionId: 'truth', text: 'Ottawa' },
  { optionId: 'mine', text: 'Maple City' },
  { optionId: 'theirs', text: 'Moose Town' },
];

function bluffAssignment(bluff: Partial<NonNullable<PlayerAssignment['bluff']>>): PlayerAssignment {
  return {
    prompts: [],
    votedMatchupId: null,
    bluff: { questionId: QUESTION.id, submitted: false, ownOptionIds: [], pickedOptionId: null, ...bluff },
  };
}

beforeEach(() => {
  emitAck.mockReset();
  emitAck.mockResolvedValue({ ok: true, data: null });
});

describe('PlayerScreen bluff', () => {
  it('sends a lie and then waits', async () => {
    const user = userEvent.setup();
    renderPlayer(bluffState('answering', {}));
    expect(screen.getByText(QUESTION.text)).not.toBeNull();
    await user.type(screen.getByLabelText(/your lie/i), '  Maple City  ');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(emitAck).toHaveBeenCalledWith('bluff:lie', { questionId: 'q1', text: 'Maple City' });
    expect(screen.getByRole('heading').textContent).toMatch(/sent/i);
  });

  it('explains that the real answer cannot be used as a lie', async () => {
    const user = userEvent.setup();
    emitAck.mockResolvedValue({ ok: false, error: 'answer_is_truth' });
    renderPlayer(bluffState('answering', {}));
    await user.type(screen.getByLabelText(/your lie/i), 'Ottawa{Enter}');
    expect(screen.getByRole('alert').textContent).toMatch(/real answer/i);
    expect(screen.getByLabelText(/your lie/i)).not.toBeNull();
  });

  it('remembers a lie sent before a reconnect', () => {
    renderPlayer(bluffState('answering', {}), bluffAssignment({ submitted: true }));
    expect(screen.queryByLabelText(/your lie/i)).toBeNull();
  });

  it('never lets a player pick their own lie', async () => {
    const user = userEvent.setup();
    renderPlayer(bluffState('voting', { options: OPTIONS }), bluffAssignment({ ownOptionIds: ['mine'] }));
    const own = screen.getByRole('button', { name: /Maple City/ }) as HTMLButtonElement;
    expect(own.disabled).toBe(true);
    expect(screen.getByText('Your lie')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: /Ottawa/ }));
    expect(emitAck).toHaveBeenCalledWith('bluff:pick', { questionId: 'q1', optionId: 'truth' });
    expect(screen.getByRole('heading').textContent).toMatch(/locked/i);
  });

  it('keeps the audience waiting while players pick', () => {
    renderPlayer(
      bluffState('voting', { options: OPTIONS }, {
        players: [player('p2'), player('p3'), player('p4')],
        audience: [{ id: ME, name: 'ME', avatar: 'fox', connected: true, hasVoted: false }],
      }),
    );
    expect(screen.queryByRole('button', { name: /Ottawa/ })).toBeNull();
  });

  const reveal = {
    options: [
      { optionId: 'truth', text: 'Ottawa', isTruth: true, authors: [], pickers: [] },
      { optionId: 'theirs', text: 'Moose Town', isTruth: false, authors: [{ name: 'P2', avatar: 'cat' }], pickers: [] },
    ],
    pointsThisRound: [
      { playerId: ME, playerName: 'ME', points: 500 },
      { playerId: 'p2', playerName: 'P2', points: 0 },
    ],
  };

  it('celebrates finding the truth', () => {
    renderPlayer(bluffState('results', { reveal }), bluffAssignment({ pickedOptionId: 'truth' }));
    expect(screen.getByRole('heading').textContent).toMatch(/found the truth/i);
    expect(screen.getByText('+500')).not.toBeNull();
  });

  it('names whose lie fooled the player and shows the truth', () => {
    renderPlayer(
      bluffState('results', { reveal: { ...reveal, pointsThisRound: [] } }),
      bluffAssignment({ pickedOptionId: 'theirs' }),
    );
    expect(screen.getByRole('heading').textContent).toMatch(/fooled/i);
    expect(screen.getByText('Lie by P2')).not.toBeNull();
    expect(screen.getByText('Ottawa')).not.toBeNull();
  });
});

describe('PlayerScreen pause and endgame', () => {
  it('covers the controls while the game is paused', () => {
    renderPlayer(
      roomState({
        phase: 'answering',
        gameType: 'trivia',
        players: [player(ME), player('p2'), player('p3')],
        pausedRemainingMs: 9_000,
        trivia: {
          questionIndex: 0,
          totalQuestions: 3,
          question: { id: 't1', text: 'Question?', options: ['A1', 'B1', 'C1', 'D1'] },
          reveal: null,
        },
      }),
    );
    expect(screen.getByRole('status').textContent).toMatch(/paused/i);
  });

  it('shows the session total from the second game on, and a share button', () => {
    renderPlayer(
      roomState({
        phase: 'gameover',
        gameType: 'quiplash',
        players: [player(ME, { score: 400, sessionScore: 1_700 }), player('p2'), player('p3')],
        gamesPlayed: 2,
        highlights: [],
      }),
    );
    expect(screen.getByText('Session total: 1700')).not.toBeNull();
    expect(screen.getByRole('button', { name: /share results/i })).not.toBeNull();
  });
});
