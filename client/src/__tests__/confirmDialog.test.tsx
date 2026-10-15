import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from '../components/ConfirmDialog';
import { renderApp } from './helpers';

function open() {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const view = renderApp(
    <>
      <button type="button">Behind the dialog</button>
      <ConfirmDialog message="End the game?" onConfirm={onConfirm} onCancel={onCancel} />
    </>,
  );
  return { ...view, onConfirm, onCancel };
}

describe('ConfirmDialog focus', () => {
  it('starts on the confirm button and wraps Tab at both ends', async () => {
    const user = userEvent.setup();
    open();
    const [yes, no] = screen.getAllByRole('button').filter((b) => b.closest('[role="alertdialog"]'));
    expect(document.activeElement).toBe(yes);
    await user.tab();
    expect(document.activeElement).toBe(no);
    await user.tab();
    expect(document.activeElement).toBe(yes);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(no);
  });

  it('pulls focus back inside when it has fallen to the page behind', () => {
    open();
    const behind = screen.getByRole('button', { name: 'Behind the dialog' });
    behind.focus();
    expect(document.activeElement).toBe(behind);

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(document.activeElement?.closest('[role="alertdialog"]')).not.toBeNull();
  });

  it('cancels on Escape and returns focus to whoever opened it', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const { onCancel, unmount } = open();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
