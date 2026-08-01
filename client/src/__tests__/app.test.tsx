import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted above module scope, so the fake socket has to be built
// inside vi.hoisted to exist by the time the factory runs.
const { socket, listeners, managerListeners, emitAck } = vi.hoisted(() => {
  const events = new Map<string, Set<(value?: unknown) => void>>();
  const manager = new Map<string, Set<() => void>>();
  return {
    listeners: events,
    managerListeners: manager,
    emitAck: vi.fn(),
    /** A stand-in for the socket.io client, driven by the test. */
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

const STORED_SESSION = {
  role: 'player',
  code: 'ABCD',
  playerId: 'me',
  resumeToken: 'a'.repeat(43),
};

describe('App link state', () => {
  beforeEach(() => {
    listeners.clear();
    managerListeners.clear();
    emitAck.mockReset();
    socket.connected = false;
    socket.active = true;
    socket.id = 'socket-1';
    window.history.replaceState({}, '', '/');
  });

  it('goes to the home screen when there is nothing to restore', () => {
    renderApp(<App />);
    expect(screen.getByRole('button', { name: /join a room/i })).not.toBeNull();
  });

  it('restores a stored session and hands over to the room screen', async () => {
    sessionStorage.setItem('matah.session', JSON.stringify(STORED_SESSION));
    emitAck.mockResolvedValue({
      ok: true,
      data: { code: 'ABCD', playerId: 'me', resumeToken: 'b'.repeat(43), isAudience: false },
    });
    renderApp(<App />);

    socket.connected = true;
    fire('connect');
    expect(emitAck).toHaveBeenCalledWith('room:rejoin', {
      code: 'ABCD',
      resumeToken: 'a'.repeat(43),
    });

    fire('room:state', roomState({ code: 'ABCD' }));
    await waitFor(() => expect(screen.queryByText(/getting you back/i)).toBeNull());
  });

  it('gives up with a retry rather than spinning forever', async () => {
    // A stored session plus a server that never answers used to leave the app
    // on a bare ellipsis with no timeout and no way out.
    const user = userEvent.setup();
    sessionStorage.setItem('matah.session', JSON.stringify(STORED_SESSION));
    renderApp(<App />);
    // Until the rejoin lands the app stays on Home, which is usable; the gap
    // was that a server which never answers left it there silently.
    expect(screen.getByText(/connecting to server/i)).not.toBeNull();

    fireManager('reconnect_failed');
    expect(screen.getByText(/can't reach the server/i)).not.toBeNull();

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(socket.connect).toHaveBeenCalled();
  });

  it('sends a kicked player home with an explanation', () => {
    sessionStorage.setItem('matah.session', JSON.stringify(STORED_SESSION));
    renderApp(<App />);
    fire('room:kicked');
    expect(screen.getByText(/removed you/i)).not.toBeNull();
    expect(sessionStorage.getItem('matah.session')).toBeNull();
  });

  it('sends a replaced session home with a different explanation', () => {
    sessionStorage.setItem('matah.session', JSON.stringify(STORED_SESSION));
    renderApp(<App />);
    fire('room:session-replaced');
    expect(screen.getByText(/another device/i)).not.toBeNull();
  });

  it('discards a stored session the server no longer recognises', async () => {
    sessionStorage.setItem('matah.session', JSON.stringify(STORED_SESSION));
    emitAck.mockResolvedValue({ ok: false, error: 'session_not_found' });
    renderApp(<App />);

    socket.connected = true;
    fire('connect');
    await waitFor(() =>
      expect(screen.getByText(/session expired/i)).not.toBeNull(),
    );
    expect(sessionStorage.getItem('matah.session')).toBeNull();
  });

  it('ignores a stored session that does not match the expected shape', () => {
    sessionStorage.setItem(
      'matah.session',
      JSON.stringify({ ...STORED_SESSION, code: 'not-a-code' }),
    );
    renderApp(<App />);
    expect(screen.getByRole('button', { name: /join a room/i })).not.toBeNull();
    expect(sessionStorage.getItem('matah.session')).toBeNull();
  });
});
