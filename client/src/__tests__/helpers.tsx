import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import type { Player, RoomState } from '../../../shared/src/index';
import { I18nProvider } from '../i18n';

/** A player with sane defaults; override only what a test cares about. */
export function player(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    name: id.toUpperCase(),
    avatar: 'fox',
    score: 0,
    connected: true,
    isHost: false,
    isAudience: false,
    hasSubmitted: false,
    hasVoted: false,
    streak: 0,
    ...overrides,
  };
}

/** A lobby-phase room state; override only what a test cares about. */
export function roomState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    code: 'ABCD',
    phase: 'lobby',
    gameType: null,
    language: 'en',
    round: 0,
    totalRounds: 0,
    players: [],
    audience: [],
    hostConnected: true,
    phaseId: 1,
    phaseEndsAt: null,
    serverNow: Date.now(),
    controllerPlayerId: null,
    ...overrides,
  };
}

/** Render inside the i18n provider, pinned to English. */
export function renderApp(ui: ReactElement) {
  localStorage.setItem('matah.lang', 'en');
  return render(<I18nProvider>{ui}</I18nProvider>);
}
