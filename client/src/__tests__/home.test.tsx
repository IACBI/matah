import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../socket', () => ({
  emitAck: vi.fn(),
}));
vi.mock('../sound', () => ({
  playSfx: vi.fn(),
  setMuted: vi.fn(),
  isMuted: vi.fn(() => false),
}));

import { AVATARS } from '../../../shared/src/index';
import { I18nProvider } from '../i18n';
import { Home } from '../views/Home';

describe('Home', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    localStorage.setItem('matah.lang', 'en');
  });

  it('exposes a semantic join form and keyboard-selectable avatar radios', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <Home connected onEnter={vi.fn()} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('button', { name: /join a room/i }));
    expect(screen.getByLabelText(/your name/i).getAttribute('autocomplete')).toBe('nickname');
    expect(screen.getByLabelText(/room code/i)).not.toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(AVATARS.length);

    await user.click(screen.getByRole('button', { name: /^join$/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/name.*room code.*required/i);
  });
});
