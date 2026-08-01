import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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

import type { PlayerAssignment, RoomState } from '../../../shared/src/index';
import { PlayerScreen } from '../views/PlayerScreen';
import { player, renderApp, roomState } from './helpers';

const ME = 'me';

function renderPlayer(
  state: RoomState | null,
  extra: {
    assignment?: PlayerAssignment | null;
    secondsLeft?: number | null;
    connected?: boolean;
    leaving?: boolean;
    onLeave?: () => Promise<void>;
  } = {},
) {
  return renderApp(
    <PlayerScreen
      code="ABCD"
      myPlayerId={ME}
      state={state}
      assignment={extra.assignment ?? null}
      secondsLeft={extra.secondsLeft ?? null}
      connected={extra.connected ?? true}
      leaving={extra.leaving ?? false}
      onLeave={extra.onLeave ?? vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

const QUESTION = {
  id: 'q1',
  text: 'Which planet is closest to the sun?',
  options: ['Mercury', 'Venus', 'Earth', 'Mars'],
};

describe('PlayerScreen before the room state arrives', () => {
  beforeEach(() => emitAck.mockReset());

  it('says it is joining while the socket is up', () => {
    renderPlayer(null);
    expect(screen.getByText(/joining/i)).not.toBeNull();
  });

  it('says it is connecting while the socket is down', () => {
    renderPlayer(null, { connected: false });
    expect(screen.getByText(/connecting/i)).not.toBeNull();
  });
});

describe('PlayerScreen header', () => {
  beforeEach(() => emitAck.mockReset());

  it('shows a streak only once it is worth bragging about', () => {
    const { unmount } = renderPlayer(
      roomState({ players: [player(ME, { streak: 1 })] }),
    );
    expect(screen.queryByText(/streak/i)).toBeNull();
    unmount();

    renderPlayer(roomState({ players: [player(ME, { streak: 3 })] }));
    expect(screen.getByText(/3/)).not.toBeNull();
  });

  it('marks the timer as dangerous in the last five seconds', () => {
    const { unmount } = renderPlayer(roomState({ players: [player(ME)] }), {
      secondsLeft: 9,
    });
    expect(screen.getByRole('timer').className).not.toMatch(/danger/);
    unmount();

    renderPlayer(roomState({ players: [player(ME)] }), { secondsLeft: 4 });
    expect(screen.getByRole('timer').className).toMatch(/danger/);
  });

  it('badges an audience member and hides their score', () => {
    renderPlayer(
      roomState({
        players: [player('p1')],
        audience: [{ id: ME, name: 'ME', avatar: 'fox', connected: true, hasVoted: false }],
      }),
    );
    expect(screen.getByText(/audience/i)).not.toBeNull();
    expect(screen.queryByText(/points/i)).toBeNull();
  });

  it('warns over the top of the game while the socket is down', () => {
    renderPlayer(roomState({ players: [player(ME)] }), { connected: false });
    expect(screen.getByRole('alert').textContent).toMatch(/reconnect/i);
  });
});

describe('PlayerScreen leaving', () => {
  beforeEach(() => emitAck.mockReset());

  it('leaves a lobby without asking', async () => {
    const user = userEvent.setup();
    const onLeave = vi.fn().mockResolvedValue(undefined);
    renderPlayer(roomState({ phase: 'lobby', players: [player(ME)] }), { onLeave });

    await user.click(screen.getByRole('button', { name: /leave/i }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});

describe('PlayerScreen quiplash answering', () => {
  beforeEach(() => {
    emitAck.mockReset();
    sessionStorage.clear();
  });

  const assignment: PlayerAssignment = {
    prompts: [{ matchupId: 'm1', prompt: 'A terrible slogan for a bank', submitted: false }],
  };

  function answeringState() {
    return roomState({
      phase: 'answering',
      gameType: 'quiplash',
      players: [player(ME), player('p2'), player('p3')],
    });
  }

  it('waits without a dead end until the assignment arrives', () => {
    renderPlayer(answeringState(), { assignment: null });
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('keeps send disabled until something has been typed', async () => {
    const user = userEvent.setup();
    renderPlayer(answeringState(), { assignment });

    const send = screen.getByRole('button', { name: /^send$/i });
    expect(send.hasAttribute('disabled')).toBe(true);

    await user.type(screen.getByRole('textbox'), 'Your money, our yacht');
    expect(send.hasAttribute('disabled')).toBe(false);
  });

  it('submits the answer and confirms it landed', async () => {
    const user = userEvent.setup();
    emitAck.mockResolvedValue({ ok: true });
    renderPlayer(answeringState(), { assignment });

    await user.type(screen.getByRole('textbox'), 'Your money, our yacht');
    await user.click(screen.getByRole('button', { name: /^send$/i }));

    expect(emitAck).toHaveBeenCalledWith('answer:submit', {
      matchupId: 'm1',
      text: 'Your money, our yacht',
    });
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });

  it('surfaces a rejected answer instead of pretending it sent', async () => {
    const user = userEvent.setup();
    emitAck.mockResolvedValue({ ok: false, error: 'submit_failed' });
    renderPlayer(answeringState(), { assignment });

    await user.type(screen.getByRole('textbox'), 'Too late');
    await user.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(screen.getByRole('alert')).not.toBeNull());
    // The text must stay put so the player can retry it.
    expect(screen.getByRole('textbox')).not.toBeNull();
  });

  it('restores a draft left behind by a reconnect', () => {
    sessionStorage.setItem(
      `matah.drafts.ABCD.${ME}`,
      JSON.stringify({ m1: 'Half-typed genius' }),
    );
    renderPlayer(answeringState(), { assignment });
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'Half-typed genius');
  });

  it('survives a corrupted draft blob rather than blanking the screen', () => {
    sessionStorage.setItem(`matah.drafts.ABCD.${ME}`, 'not json');
    renderPlayer(answeringState(), { assignment });
    expect(screen.getByRole('textbox')).toHaveProperty('value', '');
  });

  it('auto-submits a typed draft as the clock runs out', async () => {
    const user = userEvent.setup();
    emitAck.mockResolvedValue({ ok: true });
    const { rerender } = renderPlayer(answeringState(), {
      assignment,
      secondsLeft: 10,
    });

    await user.type(screen.getByRole('textbox'), 'Saved by the bell');
    expect(emitAck).not.toHaveBeenCalled();

    // Re-render at the auto-submit threshold: the player's own words must go up
    // rather than being replaced by a canned safety quip.
    act(() => {
      rerender(
        <PlayerScreen
          code="ABCD"
          myPlayerId={ME}
          state={answeringState()}
          assignment={assignment}
          secondsLeft={2}
          connected
          leaving={false}
          onLeave={vi.fn().mockResolvedValue(undefined)}
        />,
      );
    });

    await waitFor(() =>
      expect(emitAck).toHaveBeenCalledWith('answer:submit', {
        matchupId: 'm1',
        text: 'Saved by the bell',
      }),
    );
  });

  it('shows the waiting view once the server says everything is in', () => {
    renderPlayer(
      roomState({
        phase: 'answering',
        gameType: 'quiplash',
        players: [player(ME, { hasSubmitted: true }), player('p2'), player('p3')],
      }),
      { assignment },
    );
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('parks the audience on a watch screen', () => {
    renderPlayer(
      roomState({
        phase: 'answering',
        gameType: 'quiplash',
        players: [player('p1'), player('p2'), player('p3')],
        audience: [{ id: ME, name: 'ME', avatar: 'fox', connected: true, hasVoted: false }],
      }),
      { assignment },
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText(/audience/i)).not.toBeNull();
  });
});

describe('PlayerScreen quiplash voting', () => {
  beforeEach(() => emitAck.mockReset());

  it('will not let an author vote on their own matchup', () => {
    renderPlayer(
      roomState({
        phase: 'voting',
        gameType: 'quiplash',
        players: [player(ME), player('p2'), player('p3')],
        quiplash: {
          currentMatchupIndex: 0,
          totalMatchups: 3,
          activeMatchup: {
            id: 'm1',
            prompt: 'A terrible slogan for a bank',
            answers: [
              { answerId: 'a1', text: 'One' },
              { answerId: 'a2', text: 'Two' },
            ],
          },
          lastResults: null,
        },
      }),
      {
        assignment: {
          prompts: [{ matchupId: 'm1', prompt: 'A terrible slogan for a bank', submitted: true }],
        },
      },
    );
    expect(screen.queryByRole('button', { name: /One/ })).toBeNull();
    expect(screen.getByText(/own/i)).not.toBeNull();
  });
});

describe('PlayerScreen trivia answering', () => {
  beforeEach(() => emitAck.mockReset());

  function triviaState(overrides: Partial<RoomState> = {}) {
    return roomState({
      phase: 'answering',
      gameType: 'trivia',
      players: [player(ME), player('p2'), player('p3')],
      trivia: { questionIndex: 0, totalQuestions: 5, question: QUESTION, reveal: null },
      ...overrides,
    });
  }

  it('waits without a dead end until the question arrives', () => {
    renderPlayer(
      triviaState({
        trivia: { questionIndex: 0, totalQuestions: 5, question: null, reveal: null },
      }),
    );
    expect(screen.queryByRole('button', { name: /Mercury/ })).toBeNull();
  });

  it('labels each option with its letter for screen readers', () => {
    renderPlayer(triviaState());
    expect(screen.getByRole('button', { name: /A.*Mercury/ })).not.toBeNull();
    expect(screen.getByRole('button', { name: /D.*Mars/ })).not.toBeNull();
  });

  it('locks the screen the moment an option is tapped', async () => {
    const user = userEvent.setup();
    emitAck.mockResolvedValue({ ok: true });
    renderPlayer(triviaState());

    await user.click(screen.getByRole('button', { name: /Mercury/ }));

    expect(emitAck).toHaveBeenCalledWith('trivia:answer', {
      questionId: 'q1',
      optionIndex: 0,
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Venus/ })).toBeNull());
  });

  it('unlocks the options again if the server refuses the answer', async () => {
    const user = userEvent.setup();
    emitAck.mockResolvedValue({ ok: false, error: 'submit_failed' });
    renderPlayer(triviaState());

    await user.click(screen.getByRole('button', { name: /Mercury/ }));

    // A refused answer must hand the question back, not strand the player on a
    // locked screen until the round moves on.
    await waitFor(() => expect(screen.getByRole('alert')).not.toBeNull());
    expect(screen.getByRole('button', { name: /Venus/ })).not.toBeNull();
  });

  it('stays locked when the server already has this player down as answered', () => {
    renderPlayer(
      triviaState({
        players: [player(ME, { hasSubmitted: true }), player('p2'), player('p3')],
      }),
    );
    expect(screen.queryByRole('button', { name: /Mercury/ })).toBeNull();
  });
});

describe('PlayerScreen trivia result', () => {
  beforeEach(() => emitAck.mockReset());

  function revealState(points: number) {
    return roomState({
      phase: 'results',
      gameType: 'trivia',
      players: [player(ME), player('p2'), player('p3')],
      trivia: {
        questionIndex: 0,
        totalQuestions: 5,
        question: QUESTION,
        reveal: {
          correctIndex: 0,
          counts: [2, 1, 0, 0],
          pointsThisRound: [{ playerId: ME, playerName: 'ME', points }],
        },
      },
    });
  }

  it('celebrates a scoring answer', () => {
    renderPlayer(revealState(120));
    expect(screen.getByText('+120')).not.toBeNull();
  });

  it('shows the right answer to a player who missed it', () => {
    renderPlayer(revealState(0));
    expect(screen.getByText('Mercury')).not.toBeNull();
  });

  it('holds the player on a waiting screen until the reveal lands', () => {
    renderPlayer(
      roomState({
        phase: 'results',
        gameType: 'trivia',
        players: [player(ME), player('p2'), player('p3')],
        trivia: { questionIndex: 0, totalQuestions: 5, question: QUESTION, reveal: null },
      }),
    );
    expect(screen.queryByText('+0')).toBeNull();
    expect(screen.getByRole('heading').textContent).toMatch(/screen/i);
  });
});

describe('PlayerScreen endgame', () => {
  beforeEach(() => emitAck.mockReset());

  function endState(phase: 'scoreboard' | 'gameover', controllerPlayerId: string | null = null) {
    return roomState({
      phase,
      gameType: 'quiplash',
      players: [player(ME, { score: 450 }), player('p2'), player('p3')],
      controllerPlayerId,
    });
  }

  it('shows the final score', () => {
    renderPlayer(endState('scoreboard'));
    expect(screen.getByText('450')).not.toBeNull();
  });

  it('offers a rematch only to the stand-in controller', () => {
    const { unmount } = renderPlayer(endState('gameover', 'p2'));
    expect(screen.queryByRole('button', { name: /play again/i })).toBeNull();
    unmount();

    renderPlayer(endState('gameover', ME));
    expect(screen.getByRole('button', { name: /play again/i })).not.toBeNull();
  });

  it('reports a refused rematch instead of failing silently', async () => {
    const user = userEvent.setup();
    emitAck.mockResolvedValue({ ok: false, error: 'not_controller' });
    renderPlayer(endState('gameover', ME));

    await user.click(screen.getByRole('button', { name: /play again/i }));

    expect(emitAck).toHaveBeenCalledWith('game:rematch', { phaseId: 1 });
    await waitFor(() => expect(screen.getByRole('alert')).not.toBeNull());
  });

  it('exits without a confirmation once the game is over', async () => {
    const user = userEvent.setup();
    const onLeave = vi.fn().mockResolvedValue(undefined);
    renderPlayer(endState('gameover'), { onLeave });

    await user.click(screen.getByRole('button', { name: /exit/i }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('disables exit while the leave is already in flight', () => {
    renderPlayer(endState('gameover'), { leaving: true });
    expect(
      screen.getByRole('button', { name: /exit/i }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('lets everyone react once the game is over', () => {
    renderPlayer(endState('gameover'));
    expect(screen.getByRole('group', { name: /reaction/i })).not.toBeNull();
  });

  it('keeps reactions away from players mid-vote', () => {
    renderPlayer(
      roomState({
        phase: 'voting',
        gameType: 'quiplash',
        players: [player(ME), player('p2'), player('p3')],
      }),
    );
    expect(screen.queryByRole('group', { name: /reaction/i })).toBeNull();
  });
});

describe('PlayerScreen draft cleanup', () => {
  beforeEach(() => {
    emitAck.mockReset();
    sessionStorage.clear();
  });

  it('clears drafts once the answering phase is behind us', () => {
    sessionStorage.setItem(
      `matah.drafts.ABCD.${ME}`,
      JSON.stringify({ m1: 'stale' }),
    );
    renderPlayer(
      roomState({
        phase: 'voting',
        gameType: 'quiplash',
        players: [player(ME), player('p2'), player('p3')],
      }),
    );
    expect(sessionStorage.getItem(`matah.drafts.ABCD.${ME}`)).toBeNull();
  });

  it('keeps drafts alive during quiplash answering', () => {
    const stored = JSON.stringify({ m1: 'still typing' });
    sessionStorage.setItem(`matah.drafts.ABCD.${ME}`, stored);
    renderPlayer(
      roomState({
        phase: 'answering',
        gameType: 'quiplash',
        players: [player(ME), player('p2'), player('p3')],
      }),
      {
        assignment: {
          prompts: [{ matchupId: 'm1', prompt: 'A slogan', submitted: false }],
        },
      },
    );
    expect(sessionStorage.getItem(`matah.drafts.ABCD.${ME}`)).toBe(stored);
  });
});

describe('PlayerScreen lobby', () => {
  beforeEach(() => emitAck.mockReset());

  it('tells the player the host has not started yet', () => {
    renderPlayer(roomState({ phase: 'lobby', players: [player(ME)] }));
    expect(screen.getByText(/ready/i)).not.toBeNull();
  });
});

describe('PlayerScreen draft storage failure', () => {
  beforeEach(() => {
    emitAck.mockReset();
    sessionStorage.clear();
  });

  it('keeps typing usable when sessionStorage refuses to write', async () => {
    const user = userEvent.setup();
    // Only sessionStorage: renderApp pins the language through localStorage.
    const setItem = vi
      .spyOn(window.sessionStorage, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota exceeded');
      });
    try {
      renderPlayer(
        roomState({
          phase: 'answering',
          gameType: 'quiplash',
          players: [player(ME), player('p2'), player('p3')],
        }),
        {
          assignment: {
            prompts: [{ matchupId: 'm1', prompt: 'A slogan', submitted: false }],
          },
        },
      );

      // Draft persistence is best-effort; losing it must not lose the keystroke.
      await user.type(screen.getByRole('textbox'), 'still here');
      expect(screen.getByRole('textbox')).toHaveProperty('value', 'still here');
    } finally {
      setItem.mockRestore();
    }
  });
});

describe('PlayerScreen reconnect during voting', () => {
  beforeEach(() => {
    emitAck.mockReset();
    emitAck.mockResolvedValue({ ok: true });
  });

  it('resets the vote view when the matchup changes', () => {
    const base = (matchupId: string) =>
      roomState({
        phase: 'voting',
        gameType: 'quiplash',
        players: [player(ME), player('p2'), player('p3')],
        quiplash: {
          currentMatchupIndex: 0,
          totalMatchups: 3,
          activeMatchup: {
            id: matchupId,
            prompt: 'A prompt',
            answers: [
              { answerId: `${matchupId}-a`, text: 'First' },
              { answerId: `${matchupId}-b`, text: 'Second' },
            ],
          },
          lastResults: null,
        },
      });

    const { rerender } = renderPlayer(base('m1'));
    fireEvent.click(screen.getByRole('button', { name: /First/ }));

    act(() => {
      rerender(
        <PlayerScreen
          code="ABCD"
          myPlayerId={ME}
          state={base('m2')}
          assignment={null}
          secondsLeft={null}
          connected
          leaving={false}
          onLeave={vi.fn().mockResolvedValue(undefined)}
        />,
      );
    });

    // A new matchup must offer a fresh, enabled pair of buttons.
    const first = screen.getByRole('button', { name: /First/ });
    expect(first.hasAttribute('disabled')).toBe(false);
    expect(first.className).not.toMatch(/chosen/);
  });
});
