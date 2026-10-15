import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same fake socket as app.test.tsx. vi.mock is hoisted above module scope, so
// the socket has to be built inside vi.hoisted.
const { socket, listeners, managerListeners, emitAck } = vi.hoisted(() => {
  const events = new Map<string, Set<(value?: unknown) => void>>();
  const manager = new Map<string, Set<() => void>>();
  return {
    listeners: events,
    managerListeners: manager,
    emitAck: vi.fn(),
    socket: {
      id: 'socket-1',
      connected: false,
      active: true,
      connect: vi.fn(),
      on(event: string, handler: (value?: unknown) => void) {
        if (!events.has(event)) events.set(event, new Set());
        events.get(event)!.add(handler);
      },
      off(event: string, handler: (value?: unknown) => void) {
        events.get(event)?.delete(handler);
      },
      io: {
        on(event: string, handler: () => void) {
          if (!manager.has(event)) manager.set(event, new Set());
          manager.get(event)!.add(handler);
        },
        off(event: string, handler: () => void) {
          manager.get(event)?.delete(handler);
        },
      },
    },
  };
});

vi.mock('../socket', () => ({
  socket,
  emitAck: (...args: unknown[]) => emitAck(...args),
}));
vi.mock('../sound', () => ({
  playSfx: vi.fn(),
  haptic: vi.fn(),
  setMuted: vi.fn(),
  isMuted: vi.fn(() => false),
}));

import { App } from '../App';
import { translate } from '../i18n/translations';
import { renderApp, roomState } from './helpers';

function fire(event: string, value?: unknown) {
  act(() => {
    for (const handler of listeners.get(event) ?? []) handler(value);
  });
}

function fireManager(event: string) {
  act(() => {
    for (const handler of managerListeners.get(event) ?? []) handler();
  });
}

/** Lets a settled emitAck continuation run inside act. */
async function flushAck() {
  await act(async () => {});
}

function linkState(): string {
  return JSON.parse(window.render_game_to_text?.() ?? '{}').link;
}

const RESTART_NOTICE = translate('en', 'serverRestarting');
const STORED_SESSION = {
  role: 'player',
  code: 'ABCD',
  playerId: 'me',
  resumeToken: 'a'.repeat(43),
};
const REJOINED = {
  ok: true,
  data: { code: 'ABCD', playerId: 'me', resumeToken: 'b'.repeat(43), isAudience: false },
};

/** Connects, rejoins, and lands in the room so the notice has somewhere to render. */
async function enterRoom() {
  emitAck.mockResolvedValueOnce(REJOINED);
  socket.connected = true;
  fire('connect');
  await waitFor(() => expect(emitAck).toHaveBeenCalledTimes(1));
  fire('room:state', roomState({ code: 'ABCD' }));
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: translate('en', 'ready') })).not.toBeNull(),
  );
}

describe('App server restart notice', () => {
  beforeEach(() => {
    listeners.clear();
    managerListeners.clear();
    emitAck.mockReset();
    socket.connect.mockClear();
    sessionStorage.clear();
    socket.connected = false;
    socket.active = true;
    socket.id = 'socket-1';
    window.history.replaceState({}, '', '/');
    sessionStorage.setItem('matah.session', JSON.stringify(STORED_SESSION));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a calm restart notice, keeps the session, and clears it after the rejoin', async () => {
    renderApp(<App />);
    await enterRoom();

    fire('room:server-restarting');
    socket.connected = false;
    fire('disconnect');

    expect(screen.getByText(RESTART_NOTICE)).not.toBeNull();
    expect(screen.queryByText(/can't reach the server/i)).toBeNull();
    expect(sessionStorage.getItem('matah.session')).not.toBeNull();

    emitAck.mockResolvedValueOnce(REJOINED);
    socket.connected = true;
    fire('connect');
    await waitFor(() => expect(screen.queryByText(RESTART_NOTICE)).toBeNull());
    expect(linkState()).toBe('live');
    expect(sessionStorage.getItem('matah.session')).not.toBeNull();
  });

  it('holds the notice past the unreachable timer and redials after a server-side disconnect', async () => {
    renderApp(<App />);
    await enterRoom();

    // The timer is only armed once the restart drop has happened, so faking it
    // here covers the window the restart notice has to survive.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fire('room:server-restarting');
    socket.connected = false;
    socket.active = false;
    fire('disconnect', 'io server disconnect');

    expect(socket.connect).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(9_000);
    });
    expect(screen.getByText(RESTART_NOTICE)).not.toBeNull();
    expect(screen.queryByText(/can't reach the server/i)).toBeNull();
    expect(linkState()).toBe('connecting');
  });

  it('still reports unreachable when socket.io gives up during a restart', async () => {
    renderApp(<App />);
    await enterRoom();

    fire('room:server-restarting');
    socket.connected = false;
    fire('disconnect');
    fireManager('reconnect_failed');

    expect(screen.queryByText(RESTART_NOTICE)).toBeNull();
    expect(screen.getByText(/can't reach the server/i)).not.toBeNull();
    expect(linkState()).toBe('unreachable');
    await flushAck();
  });
});
