import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitAck = vi.fn();
vi.mock('../socket', () => ({ emitAck: (...args: unknown[]) => emitAck(...args) }));
vi.mock('../sound', () => ({
  playSfx: vi.fn(),
  haptic: vi.fn(),
  setMuted: vi.fn(),
  isMuted: vi.fn(() => false),
}));

import { PlayerScreen } from '../views/PlayerScreen';
import { player, renderApp, roomState } from './helpers';

const MATCHUP = {
  id: 'm1',
  prompt: 'The worst possible name for a boat',
  answers: [
    { answerId: 'a1', text: 'Titanic II' },
    { answerId: 'a2', text: 'Sinky McSinkface' },
  ],
};

function votingState(me: ReturnType<typeof player>) {
  return roomState({
    phase: 'voting',
    gameType: 'quiplash',
    round: 1,
    totalRounds: 3,
    players: [me, player('p2'), player('p3')],
    quiplash: {
      currentMatchupIndex: 0,
      totalMatchups: 3,
      activeMatchup: MATCHUP,
      lastResults: null,
    },
  });
}

function renderVoting(me: ReturnType<typeof player>) {
  return renderApp(
    <PlayerScreen
      code="ABCD"
      myPlayerId={me.id}
      state={votingState(me)}
      assignment={{ prompts: [] }}
      secondsLeft={12}
      connected
      leaving={false}
      onLeave={vi.fn()}
    />,
  );
}

describe('PlayerScreen voting', () => {
  beforeEach(() => {
    emitAck.mockReset();
    sessionStorage.clear();
  });

  it('offers the answers when this player has not voted yet', () => {
    renderVoting(player('me'));
    expect(screen.getByRole('button', { name: /Titanic II/ })).not.toBeNull();
    expect(screen.getByRole('button', { name: /Sinky/ })).not.toBeNull();
  });

  it('shows the vote as saved when the server says it landed', () => {
    // A reconnect remounts this view with no local state. Before reading
    // `hasVoted`, the buttons came back and every tap returned vote_failed
    // until the matchup advanced.
    renderVoting(player('me', { hasVoted: true }));
    expect(screen.queryByRole('button', { name: /Titanic II/ })).toBeNull();
    expect(screen.getByText(/vote saved/i)).not.toBeNull();
  });

  it('trusts the server for an audience member too', () => {
    const me = player('watcher', { isAudience: true, hasVoted: true });
    renderApp(
      <PlayerScreen
        code="ABCD"
        myPlayerId={me.id}
        state={roomState({
          phase: 'voting',
          gameType: 'quiplash',
          players: [player('p1'), player('p2'), player('p3')],
          audience: [
            { id: me.id, name: me.name, avatar: me.avatar, connected: true, hasVoted: true },
          ],
          quiplash: {
            currentMatchupIndex: 0,
            totalMatchups: 3,
            activeMatchup: MATCHUP,
            lastResults: null,
          },
        })}
        assignment={null}
        secondsLeft={12}
        connected
        leaving={false}
        onLeave={vi.fn()}
      />,
    );
    expect(screen.getByText(/vote saved/i)).not.toBeNull();
  });

  it('marks the tapped answer immediately and reverts if the server refuses', async () => {
    const user = userEvent.setup();
    emitAck.mockResolvedValue({ ok: false, error: 'vote_failed' });
    renderVoting(player('me'));

    await user.click(screen.getByRole('button', { name: /Titanic II/ }));
    expect(emitAck).toHaveBeenCalledWith('vote:submit', {
      matchupId: 'm1',
      answerId: 'a1',
    });
    // A rejected vote must release the optimistic choice, not strand the UI.
    expect(screen.getByRole('alert').textContent).toMatch(/vote/i);
    expect(screen.getByRole('button', { name: /Titanic II/ }).className).not.toMatch(/chosen/);
  });

  it('waits without a dead end when the matchup is between pairs', () => {
    const me = player('me');
    renderApp(
      <PlayerScreen
        code="ABCD"
        myPlayerId={me.id}
        state={roomState({
          phase: 'voting',
          gameType: 'quiplash',
          players: [me, player('p2'), player('p3')],
          quiplash: {
            currentMatchupIndex: 0,
            totalMatchups: 3,
            activeMatchup: null,
            lastResults: null,
          },
        })}
        assignment={null}
        secondsLeft={2}
        connected
        leaving={false}
        onLeave={vi.fn()}
      />,
    );
    expect(screen.getByText(/counting the votes/i)).not.toBeNull();
  });
});

describe('PlayerScreen leaving', () => {
  beforeEach(() => {
    emitAck.mockReset();
    sessionStorage.clear();
  });

  it('confirms before abandoning a game in progress', async () => {
    const user = userEvent.setup();
    const onLeave = vi.fn().mockResolvedValue(undefined);
    renderApp(
      <PlayerScreen
        code="ABCD"
        myPlayerId="me"
        state={votingState(player('me'))}
        assignment={null}
        secondsLeft={12}
        connected
        leaving={false}
        onLeave={onLeave}
      />,
    );

    await user.click(screen.getByRole('button', { name: /leave/i }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).not.toBeNull();
    expect(onLeave).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onLeave).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /leave/i }));
    await user.click(screen.getByRole('button', { name: /^yes$/i }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});
