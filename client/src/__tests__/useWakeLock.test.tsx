import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useWakeLock } from '../useWakeLock';

function Probe({ active }: { active: boolean }) {
  useWakeLock(active);
  return null;
}

function stubWakeLock(request: () => Promise<unknown>) {
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
}

function sentinel() {
  return { released: false, release: vi.fn().mockResolvedValue(undefined) };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'wakeLock');
});

describe('useWakeLock', () => {
  it('requests a screen lock while active and releases it on unmount', async () => {
    const lock = sentinel();
    const request = vi.fn().mockResolvedValue(lock);
    stubWakeLock(request);

    const { unmount } = render(<Probe active />);
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
    await Promise.resolve();
    unmount();

    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('asks again when the page returns to the foreground after the browser dropped the lock', async () => {
    const first = sentinel();
    const second = sentinel();
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    stubWakeLock(request);
    render(<Probe active />);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    first.released = true;
    document.dispatchEvent(new Event('visibilitychange'));

    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it('does nothing when inactive, unsupported, or refused', async () => {
    const request = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    stubWakeLock(request);
    render(<Probe active={false} />);
    expect(request).not.toHaveBeenCalled();

    render(<Probe active />);
    await vi.waitFor(() => expect(request).toHaveBeenCalled());

    Reflect.deleteProperty(navigator, 'wakeLock');
    expect(() => render(<Probe active />)).not.toThrow();
  });
});
