import { act, screen, waitFor } from '@testing-library/react';
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

const assignment: PlayerAssignment = {
  prompts: [{ matchupId: 'm1', prompt: 'A terrible slogan for a bank', submitted: false }],
  votedMatchupId: null,
};

function answering(overrides: Partial<RoomState> = {}) {
  return roomState({
    phase: 'answering',
    gameType: 'quiplash',
    players: [player(ME), player('p2'), player('p3')],
    ...overrides,
  });
}

function screenFor(state: RoomState, secondsLeft: number | null) {
  return (
    <PlayerScreen
      code="ABCD"
      myPlayerId={ME}
      state={state}
      assignment={assignment}
      secondsLeft={secondsLeft}
      connected
      leaving={false}
      onLeave={vi.fn().mockResolvedValue(undefined)}
    />
  );
}

describe('PlayerScreen while the host has paused the game', () => {
  beforeEach(() => {
    emitAck.mockReset();
    sessionStorage.clear();
  });

  it('does not flag the frozen clock as running out', () => {
    renderApp(screenFor(answering({ pausedRemainingMs: 3_000 }), 3));
    expect(screen.getByRole('timer').className).not.toMatch(/danger/);
  });

  it('holds back the draft auto-submit that a running clock would fire', async () => {
    const user = userEvent.setup();
    emitAck.mockResolvedValue({ ok: true });
    const { rerender } = renderApp(screenFor(answering(), 10));
    await user.type(screen.getByRole('textbox'), 'Half a thought');

    // The server refuses answers while paused, so sending would only surface
    // a "game paused" error on the player's phone.
    act(() => {
      rerender(screenFor(answering({ pausedRemainingMs: 2_000 }), 2));
    });
    expect(emitAck).not.toHaveBeenCalled();

    // Resumed with the clock still that low: now the draft goes up.
    act(() => {
      rerender(screenFor(answering(), 2));
    });
    await waitFor(() =>
      expect(emitAck).toHaveBeenCalledWith('answer:submit', {
        matchupId: 'm1',
        text: 'Half a thought',
      }),
    );
  });
});
