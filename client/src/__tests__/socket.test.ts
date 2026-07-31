import { beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => {
  let acknowledgement: ((error: Error | null, response?: unknown) => void) | null = null;
  let disconnectHandler: (() => void) | null = null;
  const socket = {
    connected: true,
    timeout: vi.fn(() => ({
      emit: vi.fn((_event: string, ...args: unknown[]) => {
        acknowledgement = args.at(-1) as typeof acknowledgement;
      }),
    })),
    once: vi.fn((_event: string, handler: () => void) => {
      disconnectHandler = handler;
    }),
    off: vi.fn((_event: string, handler: () => void) => {
      if (disconnectHandler === handler) disconnectHandler = null;
    }),
  };
  return {
    socket,
    acknowledge(error: Error | null, response?: unknown) {
      acknowledgement?.(error, response);
    },
    disconnect() {
      socket.connected = false;
      disconnectHandler?.();
    },
    reset() {
      acknowledgement = null;
      disconnectHandler = null;
      socket.connected = true;
      vi.clearAllMocks();
    },
  };
});

vi.mock('socket.io-client', () => ({ io: () => transport.socket }));

import { emitAck } from '../socket';

describe('emitAck', () => {
  beforeEach(() => transport.reset());

  it('returns disconnected without emitting', async () => {
    transport.socket.connected = false;
    await expect(emitAck('room:leave')).resolves.toEqual({ ok: false, error: 'disconnected' });
    expect(transport.socket.timeout).not.toHaveBeenCalled();
  });

  it('returns a successful or server-error acknowledgement', async () => {
    const success = emitAck('room:leave');
    transport.acknowledge(null, { ok: true, data: undefined });
    await expect(success).resolves.toEqual({ ok: true, data: undefined });

    const failure = emitAck('room:leave');
    transport.acknowledge(null, { ok: false, error: 'not_in_room' });
    await expect(failure).resolves.toEqual({ ok: false, error: 'not_in_room' });
  });

  it('distinguishes ack timeout from a mid-flight disconnect and settles once', async () => {
    const timedOut = emitAck('room:leave');
    transport.acknowledge(new Error('timeout'));
    await expect(timedOut).resolves.toEqual({ ok: false, error: 'request_timeout' });

    transport.reset();
    const disconnected = emitAck('room:leave');
    transport.disconnect();
    transport.acknowledge(null, { ok: true, data: undefined });
    await expect(disconnected).resolves.toEqual({ ok: false, error: 'disconnected' });
  });
});
