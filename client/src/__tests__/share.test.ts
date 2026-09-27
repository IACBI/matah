import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '../i18n/translations';
import { buildSummary, shareSummary } from '../share';
import { player, roomState } from './helpers';

const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
  translate('en', key, params);

describe('buildSummary', () => {
  it('ranks everyone, quotes the best moments and links back to the game', () => {
    const text = buildSummary(
      roomState({
        phase: 'gameover',
        gameType: 'bluff',
        players: [player('p1', { score: 300 }), player('p2', { score: 900 }), player('p3', { score: 0 }), player('p4', { score: 10 })],
        highlights: [
          { kind: 'lie', prompt: 'Q', text: 'Moose Town', authors: [{ name: 'P1', avatar: 'fox' }, { name: 'P4', avatar: 'cat' }], votes: 2 },
          { kind: 'lie', prompt: 'Q', text: 'Second', authors: [{ name: 'P2', avatar: 'fox' }], votes: 1 },
          { kind: 'lie', prompt: 'Q', text: 'Not shared', authors: [{ name: 'P3', avatar: 'fox' }], votes: 1 },
        ],
      }),
      t,
      'https://matah.example',
    );
    expect(text.split('\n')).toEqual([
      'Matah — Bluff',
      '🥇 P2 — 900',
      '🥈 P1 — 300',
      '🥉 P4 — 10',
      '4. P3 — 0',
      '',
      '“Moose Town” — P1, P4',
      '“Second” — P2',
      '',
      'Play Matah: https://matah.example',
    ]);
  });
});

describe('shareSummary', () => {
  const original = { share: navigator.share, clipboard: navigator.clipboard };

  afterEach(() => {
    Object.defineProperty(navigator, 'share', { value: original.share, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: original.clipboard, configurable: true });
  });

  function stub(share: unknown, writeText = vi.fn().mockResolvedValue(undefined)) {
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    return writeText;
  }

  it('uses the platform share sheet when there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = stub(share);
    expect(await shareSummary('Title', 'Body')).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'Title', text: 'Body' });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('respects a dismissed share sheet instead of copying behind the user’s back', async () => {
    const writeText = stub(vi.fn().mockRejectedValue(Object.assign(new Error('no'), { name: 'AbortError' })));
    expect(await shareSummary('Title', 'Body')).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard without a share sheet, or when it fails', async () => {
    let writeText = stub(undefined);
    expect(await shareSummary('Title', 'Body')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('Body');

    writeText = stub(vi.fn().mockRejectedValue(new Error('NotAllowedError')));
    expect(await shareSummary('Title', 'Body')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('Body');
  });

  it('reports a failure when nothing works', async () => {
    stub(undefined, vi.fn().mockRejectedValue(new Error('denied')));
    expect(await shareSummary('Title', 'Body')).toBe('failed');
  });
});
