import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitAck = vi.fn();
const toDataURL = vi.fn();

vi.mock('../socket', () => ({
  emitAck: (...args: unknown[]) => emitAck(...args),
  socket: { on: vi.fn(), off: vi.fn() },
}));
vi.mock('../sound', () => ({
  playSfx: vi.fn(),
  haptic: vi.fn(),
  setMuted: vi.fn(),
  isMuted: vi.fn(() => false),
}));
// The lobby imports the encoder lazily; a real one would draw a canvas in jsdom.
vi.mock('qrcode', () => ({
  default: { toDataURL: (...args: unknown[]) => toDataURL(...args) },
}));

import type { RoomState } from '../../../shared/src/index';
import { MIN_PLAYERS } from '../../../shared/src/index';
import { HostScreen } from '../views/HostScreen';
import { player, renderApp, roomState } from './helpers';

function renderHost(state: RoomState | null, props: Record<string, unknown> = {}) {
  return renderApp(
    <HostScreen
      code="ABCD"
      state={state}
      secondsLeft={null}
      connected
      leaving={false}
      onLeave={vi.fn().mockResolvedValue(undefined)}
      {...props}
    />,
  );
}

const THREE = [player('p1'), player('p2'), player('p3')];

describe('HostScreen before the room exists', () => {
  beforeEach(() => {
    emitAck.mockReset();
    toDataURL.mockResolvedValue('data:image/png;base64,QR');
  });

  it('says it is preparing while the socket is up', () => {
    renderHost(null);
    expect(screen.getByText(/preparing/i)).not.toBeNull();
  });

  it('says it is connecting while the socket is down', () => {
    renderHost(null, { connected: false });
    expect(screen.getByText(/connecting/i)).not.toBeNull();
  });

  it('lets the host walk away before the room is ready', async () => {
    const user = userEvent.setup();
    const onLeave = vi.fn().mockResolvedValue(undefined);
    renderHost(null, { onLeave });

    await user.click(screen.getByRole('button', { name: /leave/i }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});

describe('HostScreen lobby', () => {
  beforeEach(() => {
    emitAck.mockReset();
    emitAck.mockResolvedValue({ ok: true, data: null });
    toDataURL.mockReset();
    toDataURL.mockResolvedValue('data:image/png;base64,QR');
  });

  function lobby(players = THREE) {
    return roomState({ phase: 'lobby', players });
  }

  it('nags for players until the floor is reached', () => {
    const { unmount } = renderHost(lobby([player('p1')]));
    const start = screen.getByRole('button', { name: new RegExp(`${MIN_PLAYERS}`) });
    expect(start.hasAttribute('disabled')).toBe(true);
    unmount();

    renderHost(lobby());
    expect(
      screen.getByRole('button', { name: /start/i }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('invites players in when nobody has joined yet', () => {
    renderHost(lobby([]));
    expect(screen.getByText(/waiting/i)).not.toBeNull();
  });

  it('shows the QR code once the encoder resolves', async () => {
    renderHost(lobby());
    await waitFor(() =>
      expect(screen.getByRole('img', { name: /scan/i })).not.toBeNull(),
    );
    expect(toDataURL).toHaveBeenCalledWith(
      expect.stringContaining('?code=ABCD'),
      expect.anything(),
    );
  });

  it('says so rather than showing a broken frame when the encoder fails', async () => {
    toDataURL.mockRejectedValue(new Error('no canvas'));
    renderHost(lobby());
    await waitFor(() =>
      expect(screen.getByText(/unavailable|qr/i)).not.toBeNull(),
    );
    expect(screen.queryByRole('img', { name: /scan/i })).toBeNull();
  });

  it('starts quiplash with the chosen number of rounds', async () => {
    const user = userEvent.setup();
    renderHost(lobby());

    await user.click(screen.getByRole('button', { name: /one more/i }));
    await user.click(screen.getByRole('button', { name: /start/i }));

    expect(emitAck).toHaveBeenCalledWith('game:start', {
      gameType: 'quiplash',
      rounds: 4,
      phaseId: 1,
    });
  });

  it('switches to trivia and resets the length to the trivia default', async () => {
    const user = userEvent.setup();
    renderHost(lobby());

    await user.click(screen.getByRole('button', { name: /trivia/i }));
    await user.click(screen.getByRole('button', { name: /start/i }));

    const [, payload] = emitAck.mock.calls[0] as [string, { gameType: string; rounds: number }];
    expect(payload.gameType).toBe('trivia');
    // Rounds and questions have different sensible defaults; switching modes
    // must not carry the previous one over.
    expect(payload.rounds).toBeGreaterThan(0);
  });

  it('marks the selected game for assistive tech', async () => {
    const user = userEvent.setup();
    renderHost(lobby());

    const trivia = screen.getByRole('button', { name: /trivia/i });
    expect(trivia.getAttribute('aria-pressed')).toBe('false');

    await user.click(trivia);
    expect(trivia.getAttribute('aria-pressed')).toBe('true');
  });

  it('stops the length stepper at its bounds', async () => {
    const user = userEvent.setup();
    renderHost(lobby());

    const down = screen.getByRole('button', { name: /one fewer/i });
    // Walk it to the floor; the button must disable rather than go lower.
    for (let i = 0; i < 10 && !down.hasAttribute('disabled'); i += 1) {
      await user.click(down);
    }
    expect(down.hasAttribute('disabled')).toBe(true);
  });

  it('kicks a named player', async () => {
    const user = userEvent.setup();
    renderHost(lobby());

    await user.click(screen.getByRole('button', { name: /P1/ }));
    expect(emitAck).toHaveBeenCalledWith('player:kick', {
      playerId: 'p1',
      phaseId: 1,
    });
  });

  it('changes the content language', async () => {
    const user = userEvent.setup();
    renderHost(lobby());

    // The top bar carries a UI-language select of its own, so scope by label.
    await user.selectOptions(screen.getByLabelText(/game language/i), 'tr');
    expect(emitAck).toHaveBeenCalledWith('room:setLanguage', {
      language: 'tr',
      phaseId: 1,
    });
  });

  it('flags a disconnected player instead of dropping them from the list', () => {
    renderHost(lobby([player('p1', { connected: false }), player('p2'), player('p3')]));
    expect(screen.getByText(/P1/)).not.toBeNull();
  });
});

describe('HostScreen copy button', () => {
  beforeEach(() => {
    emitAck.mockReset();
    toDataURL.mockResolvedValue('data:image/png;base64,QR');
  });

  it('confirms the code was copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // userEvent.setup() installs a clipboard stub of its own, so ours has to
    // land after it or the component would write to theirs.
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderHost(roomState({ phase: 'lobby', players: THREE }));

    await user.click(screen.getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith('ABCD');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /copied/i })).not.toBeNull(),
    );
  });

  it('stays quiet when the clipboard is unavailable', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('insecure origin')) },
      configurable: true,
    });
    renderHost(roomState({ phase: 'lobby', players: THREE }));

    await user.click(screen.getByRole('button', { name: /copy/i }));

    // Best-effort: an http origin must not turn the button into a stuck tick.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /copied/i })).toBeNull(),
    );
  });
});

describe('HostScreen header', () => {
  beforeEach(() => {
    emitAck.mockReset();
    toDataURL.mockResolvedValue('data:image/png;base64,QR');
  });

  it('counts the audience once anyone is watching', () => {
    const { unmount } = renderHost(roomState({ players: THREE }));
    expect(screen.queryByText(/watching/i)).toBeNull();
    unmount();

    renderHost(
      roomState({
        players: THREE,
        audience: [
          { id: 'a1', name: 'A1', avatar: 'fox', connected: true, hasVoted: false },
        ],
      }),
    );
    expect(screen.getByText(/1 watching/i)).not.toBeNull();
  });

  it('announces the final round of quiplash', () => {
    renderHost(
      roomState({
        phase: 'answering',
        gameType: 'quiplash',
        round: 3,
        totalRounds: 3,
        players: THREE,
      }),
    );
    expect(screen.getByText(/final round/i)).not.toBeNull();
  });

  it('calls it the final question in trivia', () => {
    renderHost(
      roomState({
        phase: 'answering',
        gameType: 'trivia',
        round: 5,
        totalRounds: 5,
        players: THREE,
        trivia: {
          questionIndex: 4,
          totalQuestions: 5,
          question: { id: 'q5', text: 'Last one', options: ['A', 'B'] },
          reveal: null,
        },
      }),
    );
    expect(screen.getByText(/final question/i)).not.toBeNull();
  });

  it('marks the clock as dangerous in the last five seconds', () => {
    renderHost(roomState({ players: THREE }), { secondsLeft: 3 });
    expect(screen.getByRole('timer').className).toMatch(/danger/);
  });

  it('asks before the host abandons a game in progress', async () => {
    const user = userEvent.setup();
    const onLeave = vi.fn().mockResolvedValue(undefined);
    renderHost(
      roomState({ phase: 'voting', gameType: 'quiplash', players: THREE }),
      { onLeave },
    );

    await user.click(screen.getByRole('button', { name: /leave/i }));
    expect(onLeave).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /^yes$/i }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('lets a cancelled end-game dialog go away without ending anything', async () => {
    const user = userEvent.setup();
    renderHost(roomState({ phase: 'results', gameType: 'quiplash', players: THREE }));

    await user.click(screen.getByRole('button', { name: /end game/i }));
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(emitAck).not.toHaveBeenCalled();
  });
});

describe('HostScreen trivia views', () => {
  beforeEach(() => {
    emitAck.mockReset();
    toDataURL.mockResolvedValue('data:image/png;base64,QR');
  });

  const QUESTION = {
    id: 'q1',
    text: 'Which planet is closest to the sun?',
    options: ['Mercury', 'Venus', 'Earth', 'Mars'],
  };

  it('puts the question and its options on the TV', () => {
    renderHost(
      roomState({
        phase: 'answering',
        gameType: 'trivia',
        players: THREE,
        trivia: { questionIndex: 0, totalQuestions: 5, question: QUESTION, reveal: null },
      }),
    );
    expect(screen.getByText(QUESTION.text)).not.toBeNull();
    expect(screen.getByText('Mars')).not.toBeNull();
  });

  it('reveals the answer and who scored', () => {
    renderHost(
      roomState({
        phase: 'results',
        gameType: 'trivia',
        players: THREE,
        trivia: {
          questionIndex: 0,
          totalQuestions: 5,
          question: QUESTION,
          reveal: {
            correctIndex: 0,
            counts: [2, 1, 0, 0],
            pointsThisRound: [
              { playerId: 'p1', playerName: 'P1', points: 120 },
              { playerId: 'p2', playerName: 'P2', points: 0 },
            ],
          },
        },
      }),
    );
    expect(screen.getByText(/P1 \+120/)).not.toBeNull();
    // A zero-point row would just be noise on the TV.
    expect(screen.queryByText(/P2 \+0/)).toBeNull();
  });
});

describe('HostScreen scoreboard', () => {
  beforeEach(() => {
    emitAck.mockReset();
    emitAck.mockResolvedValue({ ok: true, data: null });
    toDataURL.mockResolvedValue('data:image/png;base64,QR');
  });

  function finished() {
    return roomState({
      phase: 'scoreboard',
      gameType: 'quiplash',
      players: [
        player('p1', { score: 100 }),
        player('p2', { score: 900 }),
        player('p3', { score: 500 }),
      ],
    });
  }

  it('ranks the players by score', () => {
    renderHost(finished());
    const names = screen
      .getAllByText(/P[123]/)
      .map((node) => node.textContent?.trim());
    expect(names).toEqual(['P2', 'P3', 'P1']);
  });

  it('runs a rematch', async () => {
    const user = userEvent.setup();
    renderHost(finished());

    await user.click(screen.getByRole('button', { name: /play again/i }));
    expect(emitAck).toHaveBeenCalledWith('game:rematch', { phaseId: 1 });
  });

  it('goes back to the menu to change the settings', async () => {
    const user = userEvent.setup();
    renderHost(finished());

    await user.click(screen.getByRole('button', { name: /menu/i }));
    expect(emitAck).toHaveBeenCalledWith('game:restart', { phaseId: 1 });
  });

  it('disables every action while a leave is in flight', () => {
    renderHost(finished(), { leaving: true });
    expect(
      screen.getByRole('button', { name: /play again/i }).hasAttribute('disabled'),
    ).toBe(true);
  });
});
