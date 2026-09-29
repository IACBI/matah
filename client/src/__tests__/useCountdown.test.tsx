import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RoomState } from '../../../shared/src/index';
import { useCountdown } from '../useCountdown';

function state(overrides: Partial<RoomState> = {}): RoomState {
  return {
    code: 'ABCD',
    phase: 'answering',
    gameType: 'trivia',
    language: 'en',
    round: 1,
    totalRounds: 3,
    players: [],
    audience: [],
    hostConnected: true,
    phaseId: 1,
    phaseEndsAt: 15_000,
    serverNow: 10_000,
    controllerPlayerId: null,
    progress: { submitted: 0, voted: 0 },
    pausedRemainingMs: null,
    gamesPlayed: 0,
    customPromptCount: 0,
    customQuestionCount: 0,
    highlights: null,
    ...overrides,
  };
}

describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });

  afterEach(() => vi.useRealTimers());

  it('uses the server clock sample and reaches zero without room broadcasts', () => {
    const { result } = renderHook(() => useCountdown(state()));
    expect(result.current).toBe(5);

    act(() => vi.advanceTimersByTime(2_100));
    expect(result.current).toBe(3);

    act(() => vi.advanceTimersByTime(3_000));
    expect(result.current).toBe(0);
  });

  it('holds the frozen time while the game is paused', () => {
    const { result } = renderHook(() =>
      useCountdown(state({ phaseEndsAt: null, pausedRemainingMs: 7_200 })),
    );
    expect(result.current).toBe(8);
    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current).toBe(8);
  });

  it('returns null for phases without a deadline', () => {
    const { result } = renderHook(() => useCountdown(state({ phaseEndsAt: null })));
    expect(result.current).toBeNull();
  });
});
