import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RestoreScreen, RoomNotice } from '../components/Connection';
import { RoomErrorBoundary } from '../components/RoomErrorBoundary';
import { renderApp } from './helpers';

describe('RestoreScreen', () => {
  it('reports progress without offering a dead end while restoring', () => {
    renderApp(
      <RestoreScreen link="restoring" onRetry={vi.fn()} onLeave={vi.fn()} />,
    );
    expect(screen.getByRole('status').textContent).toMatch(/getting you back/i);
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('offers a way out once the server is declared unreachable', async () => {
    // The old behaviour was a bare ellipsis forever: no timeout, no message.
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onLeave = vi.fn();
    renderApp(
      <RestoreScreen
        link="unreachable"
        notice="errServer"
        onRetry={onRetry}
        onLeave={onLeave}
      />,
    );
    expect(screen.getByRole('status').textContent).toMatch(/can't reach the server/i);

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: /leave/i }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});

describe('RoomNotice', () => {
  it('announces an in-room problem and can retry or be dismissed', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    renderApp(
      <RoomNotice notice="errSessionExpired" onRetry={onRetry} onDismiss={onDismiss} />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/session expired/i);

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

function Boom(): never {
  throw new Error('render exploded');
}

describe('RoomErrorBoundary', () => {
  it('keeps the room code reachable instead of leaving a blank screen', () => {
    // React logs the caught error; silence it so the run stays readable.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderApp(
      <RoomErrorBoundary code="WXYZ" onLeave={vi.fn()}>
        <Boom />
      </RoomErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/ran into a problem/i);
    expect(screen.getByText('WXYZ')).not.toBeNull();
    consoleError.mockRestore();
  });

  it('renders its children untouched when nothing throws', () => {
    renderApp(
      <RoomErrorBoundary code="WXYZ" onLeave={vi.fn()}>
        <p>the game</p>
      </RoomErrorBoundary>,
    );
    expect(screen.getByText('the game')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
