import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { socket, listeners, emitAck, playSfx, haptic } = vi.hoisted(() => {
  const events = new Map<string, Set<(value?: unknown) => void>>();
  return {
    listeners: events,
    emitAck: vi.fn(),
    playSfx: vi.fn(),
    haptic: vi.fn(),
    socket: {
      on(event: string, handler: (value?: unknown) => void) {
        if (!events.has(event)) events.set(event, new Set());
        events.get(event)!.add(handler);
      },
      off(event: string, handler: (value?: unknown) => void) {
        events.get(event)?.delete(handler);
      },
    },
  };
});

vi.mock('../socket', () => ({
  socket,
  emitAck: (...args: unknown[]) => emitAck(...args),
}));
vi.mock('../sound', () => ({
  playSfx: (...args: unknown[]) => playSfx(...args),
  haptic: (...args: unknown[]) => haptic(...args),
  setMuted: vi.fn(),
  isMuted: vi.fn(() => false),
}));

import { ReactionBar, ReactionOverlay } from '../components/Reactions';
import { renderApp } from './helpers';

function fireReaction(value: unknown) {
  act(() => {
    for (const handler of listeners.get('room:reaction') ?? []) handler(value);
  });
}

const REACTION = { emoji: 'fire', name: 'Ada', avatar: 'fox' };

describe('ReactionBar', () => {
  beforeEach(() => {
    listeners.clear();
    emitAck.mockReset();
    playSfx.mockReset();
    haptic.mockReset();
  });

  it('sends the tapped reaction with sound and haptics', async () => {
    const user = userEvent.setup();
    renderApp(<ReactionBar />);

    await user.click(screen.getByRole('button', { name: /fire/i }));

    expect(emitAck).toHaveBeenCalledWith('reaction:send', { emoji: 'fire' });
    expect(playSfx).toHaveBeenCalledWith('click');
    expect(haptic).toHaveBeenCalledWith(8);
  });

  it('gives every reaction its own accessible name', () => {
    renderApp(<ReactionBar />);
    const names = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(names.length);
  });

  it('swallows taps during the cooldown instead of flooding the room', () => {
    // fireEvent rather than userEvent: userEvent awaits real time between
    // events, which never resolves once the clock is faked.
    vi.useFakeTimers();
    try {
      renderApp(<ReactionBar />);
      const fire = screen.getByRole('button', { name: /fire/i });

      fireEvent.click(fire);
      expect(emitAck).toHaveBeenCalledTimes(1);
      expect(fire.hasAttribute('disabled')).toBe(true);

      fireEvent.click(fire);
      expect(emitAck).toHaveBeenCalledTimes(1);

      act(() => {
        vi.advanceTimersByTime(700);
      });
      expect(fire.hasAttribute('disabled')).toBe(false);

      fireEvent.click(fire);
      expect(emitAck).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ReactionOverlay', () => {
  beforeEach(() => {
    listeners.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('floats an incoming reaction and clears it when the animation ends', () => {
    vi.useFakeTimers();
    renderApp(<ReactionOverlay />);

    fireReaction(REACTION);
    expect(screen.getByText('Ada')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(2600);
    });
    expect(screen.queryByText('Ada')).toBeNull();
  });

  it('caps how many floats can be on screen at once', () => {
    vi.useFakeTimers();
    renderApp(<ReactionOverlay />);

    // A reaction storm must not grow the DOM without bound.
    for (let i = 0; i < 40; i += 1) {
      fireReaction({ ...REACTION, name: `sender${i}` });
    }

    expect(screen.getAllByText(/^sender\d+$/).length).toBeLessThanOrEqual(31);
  });

  it('unsubscribes and drops pending timers on unmount', () => {
    vi.useFakeTimers();
    const { unmount } = renderApp(<ReactionOverlay />);
    // The i18n provider keeps a timer of its own, so only the delta is ours.
    const baseline = vi.getTimerCount();

    fireReaction(REACTION);
    expect(vi.getTimerCount()).toBe(baseline + 1);

    unmount();

    expect(listeners.get('room:reaction')?.size ?? 0).toBe(0);
    // Leaving the host screen mid-storm must not leave timers setting state on
    // an unmounted component.
    expect(vi.getTimerCount()).toBe(baseline);
  });
});
