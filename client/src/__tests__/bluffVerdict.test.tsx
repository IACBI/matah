import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../socket', () => ({
  socket: { on: vi.fn(), off: vi.fn() },
  emitAck: vi.fn().mockResolvedValue({ ok: true, data: null }),
}));
vi.mock('../sound', () => ({
  playSfx: vi.fn(),
  haptic: vi.fn(),
  setMuted: vi.fn(),
  isMuted: vi.fn(() => false),
}));

import type { BluffView, PlayerAssignment, RoomState } from '../../../shared/src/index';
import { playSfx } from '../sound';
import { PlayerScreen } from '../views/PlayerScreen';
import { player, renderApp, roomState } from './helpers';

const ME = 'me';
const QUESTION = { id: 'q1', text: 'What is the capital of Canada?' };

const REVEAL: NonNullable<BluffView['reveal']> = {
  options: [
    { optionId: 'truth', text: 'Ottawa', isTruth: true, authors: [], pickers: [] },
    {
      optionId: 'theirs',
      text: 'Moose Town',
      isTruth: false,
      authors: [{ name: 'P2', avatar: 'cat' }],
      pickers: [],
    },
  ],
  pointsThisRound: [{ playerId: ME, playerName: 'ME', points: 500 }],
};

function revealState(): RoomState {
  return roomState({
    phase: 'results',
    gameType: 'bluff',
    players: [player(ME), player('p2'), player('p3')],
    bluff: { questionIndex: 0, totalQuestions: 4, question: QUESTION, options: null, reveal: REVEAL },
  });
}

function assignmentFor(
  questionId: string,
  pickedOptionId: string | null,
): PlayerAssignment {
  return {
    prompts: [],
    votedMatchupId: null,
    bluff: { questionId, submitted: true, ownOptionIds: [], pickedOptionId },
  };
}

function screenFor(assignment: PlayerAssignment | null) {
  return (
    <PlayerScreen
      code="ABCD"
      myPlayerId={ME}
      state={revealState()}
      assignment={assignment}
      secondsLeft={null}
      connected
      leaving={false}
      onLeave={vi.fn().mockResolvedValue(undefined)}
    />
  );
}

beforeEach(() => {
  vi.mocked(playSfx).mockClear();
});

describe('PlayerScreen bluff verdict on reload', () => {
  it('shows a neutral reveal and no sound until the private assignment arrives', () => {
    renderApp(screenFor(null));

    expect(screen.getByRole('heading').textContent).toMatch(/results are on the screen/i);
    expect(document.querySelector('.result-right, .result-wrong')).toBeNull();
    expect(screen.queryByText('+500')).toBeNull();
    expect(playSfx).not.toHaveBeenCalled();
  });

  it('shows the win and plays one sound once the assignment arrives', () => {
    const view = renderApp(screenFor(null));

    view.rerender(screenFor(assignmentFor('q1', 'truth')));
    expect(screen.getByRole('heading').textContent).toMatch(/found the truth/i);
    expect(document.querySelector('.result-right')).not.toBeNull();
    expect(screen.getByText('+500')).not.toBeNull();
    expect(playSfx).toHaveBeenCalledTimes(1);
    expect(playSfx).toHaveBeenCalledWith('correct');

    // A later broadcast for the same question must not replay the sound.
    view.rerender(screenFor(assignmentFor('q1', 'truth')));
    expect(playSfx).toHaveBeenCalledTimes(1);
  });

  it('shows the loss and plays the wrong sound once the assignment arrives', () => {
    const view = renderApp(screenFor(null));
    expect(playSfx).not.toHaveBeenCalled();

    view.rerender(screenFor(assignmentFor('q1', 'theirs')));
    expect(screen.getByRole('heading').textContent).toMatch(/fooled/i);
    expect(document.querySelector('.result-wrong')).not.toBeNull();
    expect(playSfx).toHaveBeenCalledTimes(1);
    expect(playSfx).toHaveBeenCalledWith('wrong');
  });

  it('ignores an assignment left over from an earlier question', () => {
    renderApp(screenFor(assignmentFor('q0', 'truth')));

    expect(screen.getByRole('heading').textContent).toMatch(/results are on the screen/i);
    expect(document.querySelector('.result-right, .result-wrong')).toBeNull();
    expect(playSfx).not.toHaveBeenCalled();
  });
});
