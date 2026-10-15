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

/** The socket drops; socket.io keeps retrying on its own while `active` is true. */
function dropSocket() {
  socket.connected = false;
  socket.active = true;
  fire('disconnect');
}

/** Lets a settled emitAck continuation run inside act. */
async function flushAck() {
  await act(async () => {});
}

function linkState(): string {
  return JSON.parse(window.render_game_to_text?.() ?? '{}').link;
}

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

describe('App rejoin across a transient drop', () => {
  beforeEach(() => {
    listeners.clear();
    managerListeners.clear();
    emitAck.mockReset();
    sessionStorage.clear();
    socket.connected = false;
    socket.active = true;
    socket.id = 'socket-1';
    window.history.replaceState({}, '', '/');
  });

  it('waits for the reconnect when a rejoin ack reports the socket dropped', async () => {
    sessionStorage.setItem('matah.session', JSON.stringify(STORED_SESSION));
    emitAck.mockResolvedValueOnce({ ok: false, error: 'disconnected' });
    emitAck.mockResolvedValueOnce(REJOINED);
    renderApp(<App />);

    socket.connected = true;
    fire('connect');
    dropSocket();
    await waitFor(() => expect(emitAck).toHaveBeenCalledTimes(1));
    await flushAck();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    expect(screen.queryByText(/can't reach the server/i)).toBeNull();
    expect(linkState()).toBe('connecting');

    // socket.io reconnects by itself; the connect event reruns the rejoin.
    socket.connected = true;
    fire('connect');
    await waitFor(() => expect(emitAck).toHaveBeenCalledTimes(2));
    expect(emitAck).toHaveBeenLastCalledWith('room:rejoin', {
      code: 'ABCD',
      resumeToken: 'a'.repeat(43),
    });

    fire('room:state', roomState({ code: 'ABCD' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: translate('en', 'ready') })).not.toBeNull(),
    );
    expect(linkState()).toBe('live');
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    expect(screen.queryByText(/can't reach the server/i)).toBeNull();
  });

  it('clears the stored session on session_not_found only, and goes home', async () => {
    sessionStorage.setItem('matah.session', JSON.stringify(STORED_SESSION));
    emitAck.mockResolvedValueOnce({ ok: false, error: 'disconnected' });
    emitAck.mockResolvedValueOnce({ ok: false, error: 'session_not_found' });
    renderApp(<App />);

    socket.connected = true;
    fire('connect');
    dropSocket();
    await flushAck();
    expect(sessionStorage.getItem('matah.session')).not.toBeNull();

    socket.connected = true;
    fire('connect');
    await waitFor(() => expect(screen.getByText(/session expired/i)).not.toBeNull());
    expect(sessionStorage.getItem('matah.session')).toBeNull();
    expect(screen.getByRole('button', { name: /join a room/i })).not.toBeNull();
  });

  it('still reports a server that does not answer the rejoin in time', async () => {
    sessionStorage.setItem('matah.session', JSON.stringify(STORED_SESSION));
    emitAck.mockResolvedValueOnce({ ok: false, error: 'request_timeout' });
    renderApp(<App />);

    socket.connected = true;
    fire('connect');
    await waitFor(() => expect(screen.getByRole('button', { name: /try again/i })).not.toBeNull());
    expect(linkState()).toBe('unreachable');
    expect(sessionStorage.getItem('matah.session')).not.toBeNull();
  });

  it('still ends in unreachable when socket.io gives up after a dropped rejoin', async () => {
    sessionStorage.setItem('matah.session', JSON.stringify(STORED_SESSION));
    emitAck.mockResolvedValueOnce({ ok: false, error: 'disconnected' });
    renderApp(<App />);

    socket.connected = true;
    fire('connect');
    dropSocket();
    await flushAck();
    expect(screen.queryByText(/can't reach the server/i)).toBeNull();

    fireManager('reconnect_failed');
    expect(screen.getByText(/can't reach the server/i)).not.toBeNull();
    expect(linkState()).toBe('unreachable');
  });
});

describe('App link guard timer', () => {
  beforeEach(() => {
    listeners.clear();
    managerListeners.clear();
    emitAck.mockReset();
    sessionStorage.clear();
    socket.connected = false;
    socket.active = true;
    socket.id = 'socket-1';
    window.history.replaceState({}, '', '/');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not flip a socket that socket.io is still retrying to unreachable', () => {
    sessionStorage.setItem('matah.session', JSON.stringify(STORED_SESSION));
    renderApp(<App />);

    act(() => {
      vi.advanceTimersByTime(9_000);
    });
    expect(screen.getByText(/connecting to server/i)).not.toBeNull();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    expect(linkState()).toBe('connecting');
  });

  it('still gives up when socket.io has stopped retrying', () => {
    sessionStorage.setItem('matah.session', JSON.stringify(STORED_SESSION));
    socket.active = false;
    renderApp(<App />);

    act(() => {
      vi.advanceTimersByTime(9_000);
    });
    expect(screen.getByRole('button', { name: /try again/i })).not.toBeNull();
    expect(linkState()).toBe('unreachable');
  });
});
