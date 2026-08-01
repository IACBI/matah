import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitAck = vi.fn();
vi.mock('../socket', () => ({
  emitAck: (...args: unknown[]) => emitAck(...args),
  // ReactionOverlay subscribes to the live socket.
  socket: { on: vi.fn(), off: vi.fn() },
}));
vi.mock('../sound', () => ({
  playSfx: vi.fn(),
  haptic: vi.fn(),
  setMuted: vi.fn(),
  isMuted: vi.fn(() => false),
}));

import { HostScreen } from '../views/HostScreen';
import { player, renderApp, roomState } from './helpers';

function renderHost(state: ReturnType<typeof roomState> | null, props = {}) {
  return renderApp(
    <HostScreen
      code="ABCD"
      state={state}
      secondsLeft={null}
      connected
      leaving={false}
      onLeave={vi.fn()}
      {...props}
    />,
  );
}

const THREE = [player('p1'), player('p2'), player('p3')];

describe('HostScreen', () => {
  beforeEach(() => emitAck.mockReset());

  it('warns the room when the TV itself loses the connection', () => {
    // Players had a reconnect overlay and the host had nothing, so the TV just
    // froze with no explanation while everyone looked at it.
    renderHost(roomState({ players: THREE }), { connected: false });
    expect(screen.getByRole('alert').textContent).toMatch(/reconnect/i);
  });

  it('shows live vote progress during quiplash voting', () => {
    const voted = [
      player('p1', { hasVoted: true }),
      player('p2'),
      player('p3'),
      player('p4'),
    ];
    renderHost(
      roomState({
        phase: 'voting',
        gameType: 'quiplash',
        round: 1,
        totalRounds: 3,
        players: voted,
        quiplash: {
          currentMatchupIndex: 0,
          totalMatchups: 4,
          activeMatchup: {
            id: 'm1',
            prompt: 'A terrible superpower',
            answers: [
              { answerId: 'a1', text: 'Invisible only to yourself' },
              { answerId: 'a2', text: 'Super speed, one metre at a time' },
            ],
          },
          lastResults: null,
        },
      }),
    );
    // Four players, two of them authors, so two may vote and one has.
    expect(screen.getByRole('status').textContent).toMatch(/1\/2 voted/i);
  });

  it('says what it is waiting for between matchups instead of going blank', () => {
    renderHost(
      roomState({
        phase: 'voting',
        gameType: 'quiplash',
        players: THREE,
        quiplash: {
          currentMatchupIndex: 1,
          totalMatchups: 3,
          activeMatchup: null,
          lastResults: null,
        },
      }),
    );
    expect(screen.getByText(/next matchup/i)).not.toBeNull();
  });

  it('breaks down the score so the board does not look arbitrary', () => {
    renderHost(
      roomState({
        phase: 'results',
        gameType: 'quiplash',
        round: 2,
        totalRounds: 3,
        players: THREE,
        quiplash: {
          currentMatchupIndex: 2,
          totalMatchups: 3,
          activeMatchup: null,
          lastResults: [
            {
              prompt: 'A terrible superpower',
              answers: [
                {
                  playerId: 'p1',
                  playerName: 'P1',
                  text: 'Invisible only to yourself',
                  isSafety: false,
                  votes: 2,
                  pointsAwarded: 1333,
                  submitBonus: 200,
                },
                {
                  playerId: 'p2',
                  playerName: 'P2',
                  text: 'Super speed, one metre at a time',
                  isSafety: false,
                  votes: 1,
                  pointsAwarded: 667,
                  submitBonus: 200,
                },
              ],
            },
          ],
        },
      }),
    );
    expect(screen.getByText(/points ×2 this round/i)).not.toBeNull();
    expect(screen.getAllByText(/\+200 bonus/i)).toHaveLength(2);
  });

  it('asks before ending a game early', async () => {
    const user = userEvent.setup();
    emitAck.mockResolvedValue({ ok: true, data: null });
    renderHost(
      roomState({ phase: 'answering', gameType: 'trivia', players: THREE }),
    );

    await user.click(screen.getByRole('button', { name: /end game/i }));
    expect(emitAck).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^yes$/i }));
    expect(emitAck).toHaveBeenCalledWith('game:end', { phaseId: 1 });
  });

  it('surfaces a refused command rather than failing silently', async () => {
    const user = userEvent.setup();
    emitAck.mockResolvedValue({ ok: false, error: 'stale_phase' });
    renderHost(roomState({ phase: 'results', gameType: 'quiplash', players: THREE }));

    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/already passed/i);
  });
});
