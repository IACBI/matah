import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitAck = vi.fn();
vi.mock('../socket', () => ({
  emitAck: (...args: unknown[]) => emitAck(...args),
  socket: { on: vi.fn(), off: vi.fn() },
}));
vi.mock('../sound', () => ({
  playSfx: vi.fn(),
  haptic: vi.fn(),
  setMuted: vi.fn(),
  isMuted: vi.fn(() => false),
}));
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,QR') },
}));

import type { RoomState } from '../../../shared/src/index';
import {
  BLUFF_QUESTIONS,
  MAX_BLUFF_QUESTIONS,
  MAX_CUSTOM_PROMPTS,
  MAX_CUSTOM_QUESTIONS,
} from '../../../shared/src/index';
import { HostScreen } from '../views/HostScreen';
import { player, renderApp, roomState } from './helpers';

function renderHost(state: RoomState, props: Record<string, unknown> = {}) {
  return renderApp(
    <HostScreen
      code="ABCD"
      state={state}
      secondsLeft={null}
      connected
      leaving={false}
      onLeave={vi.fn().mockResolvedValue(undefined)}
      {...props}
    />,
  );
}

const THREE = [player('p1'), player('p2'), player('p3')];

beforeEach(() => {
  emitAck.mockReset();
  emitAck.mockResolvedValue({ ok: true, data: null });
});

describe('HostScreen pause control', () => {
  it('pauses a running phase', async () => {
    const user = userEvent.setup();
    renderHost(
      roomState({ phase: 'answering', gameType: 'trivia', players: THREE, phaseEndsAt: Date.now() + 9_000 }),
      { secondsLeft: 9 },
    );
    await user.click(screen.getByRole('button', { name: /^pause$/i }));
    expect(emitAck).toHaveBeenCalledWith('game:pause', { phaseId: 1 });
  });

  it('says the game is paused and offers to resume', async () => {
    const user = userEvent.setup();
    renderHost(
      roomState({ phase: 'voting', gameType: 'quiplash', players: THREE, phaseEndsAt: null, pausedRemainingMs: 8_000 }),
      { secondsLeft: 8 },
    );
    expect(screen.getByRole('status', { name: '' }).textContent).toMatch(/paused/i);
    const resume = screen.getByRole('button', { name: /resume/i });
    expect(resume.getAttribute('aria-pressed')).toBe('true');
    await user.click(resume);
    expect(emitAck).toHaveBeenCalledWith('game:resume', { phaseId: 1 });
  });

  it('offers nothing to pause in the lobby', () => {
    renderHost(roomState({ players: THREE }));
    expect(screen.queryByRole('button', { name: /^pause$/i })).toBeNull();
  });
});

describe('HostScreen lobby seats and prompt packs', () => {
  it('moves a player to the audience and seats a spectator', async () => {
    const user = userEvent.setup();
    renderHost(
      roomState({
        players: THREE,
        audience: [{ id: 'a1', name: 'Watcher', avatar: 'cat', connected: true, hasVoted: false }],
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Move P2 to the audience' }));
    expect(emitAck).toHaveBeenCalledWith('player:setSeat', { playerId: 'p2', audience: true, phaseId: 1 });
    await user.click(screen.getByRole('button', { name: 'Give Watcher a seat' }));
    expect(emitAck).toHaveBeenCalledWith('player:setSeat', { playerId: 'a1', audience: false, phaseId: 1 });
  });

  it('cannot seat a spectator when every seat is taken', () => {
    const full = Array.from({ length: 8 }, (_, i) => player(`p${i + 1}`));
    renderHost(
      roomState({
        players: full,
        audience: [{ id: 'a1', name: 'Watcher', avatar: 'cat', connected: true, hasVoted: false }],
      }),
    );
    const seat = screen.getByRole('button', { name: 'Give Watcher a seat' }) as HTMLButtonElement;
    expect(seat.disabled).toBe(true);
  });

  it('saves a custom prompt pack, one prompt per non-blank line', async () => {
    const user = userEvent.setup();
    renderHost(roomState({ players: THREE }));
    await user.click(screen.getByRole('button', { name: /custom prompts/i }));
    await user.type(screen.getByLabelText(/custom prompts/i), '  First prompt \n\nSecond prompt');
    await user.click(screen.getByRole('button', { name: /save prompts/i }));
    expect(emitAck).toHaveBeenCalledWith('room:setCustomPrompts', {
      prompts: ['First prompt', 'Second prompt'],
      phaseId: 1,
    });
  });

  it('refuses a pack larger than the server accepts', async () => {
    const user = userEvent.setup();
    renderHost(roomState({ players: THREE }));
    await user.click(screen.getByRole('button', { name: /custom prompts/i }));
    const lines = Array.from({ length: MAX_CUSTOM_PROMPTS + 1 }, (_, i) => `p${i}`).join('\n');
    await user.click(screen.getByLabelText(/custom prompts/i));
    await user.paste(lines);
    expect(screen.getByText(`${MAX_CUSTOM_PROMPTS + 1}/${MAX_CUSTOM_PROMPTS}`)).not.toBeNull();
    const save = screen.getByRole('button', { name: /save prompts/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('shows how many custom prompts are loaded and can clear them', async () => {
    const user = userEvent.setup();
    renderHost(roomState({ players: THREE, customPromptCount: 4 }));
    await user.click(screen.getByRole('button', { name: /custom prompts in play: 4/i }));
    await user.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(emitAck).toHaveBeenCalledWith('room:setCustomPrompts', { prompts: [], phaseId: 1 });
  });

  it('starts bluff with its own question count and bounds', async () => {
    const user = userEvent.setup();
    renderHost(roomState({ players: THREE }));
    await user.click(screen.getByRole('button', { name: /bluff/i }));
    expect(screen.queryByRole('button', { name: /custom prompts/i })).toBeNull();
    expect(screen.getByText(String(BLUFF_QUESTIONS))).not.toBeNull();
    const more = screen.getByRole('button', { name: /one more/i });
    for (let i = 0; i < 10; i += 1) await user.click(more);
    expect(screen.getByText(String(MAX_BLUFF_QUESTIONS))).not.toBeNull();
    await user.click(screen.getByRole('button', { name: /start game/i }));
    expect(emitAck).toHaveBeenCalledWith('game:start', {
      gameType: 'bluff',
      rounds: MAX_BLUFF_QUESTIONS,
      phaseId: 1,
    });
  });
});

describe('HostScreen bluff views', () => {
  const question = { id: 'q1', text: 'What is the capital of Canada?' };

  it('shows the question and who has written a lie', () => {
    renderHost(
      roomState({
        phase: 'answering',
        gameType: 'bluff',
        players: [player('p1', { hasSubmitted: true }), player('p2'), player('p3')],
        bluff: { questionIndex: 0, totalQuestions: 4, question, options: null, reveal: null },
      }),
    );
    expect(screen.getByRole('heading', { name: question.text })).not.toBeNull();
    expect(screen.getByText(/believable fake answer/i)).not.toBeNull();
  });

  it('lays out every option while the room picks', () => {
    renderHost(
      roomState({
        phase: 'voting',
        gameType: 'bluff',
        players: THREE,
        bluff: {
          questionIndex: 0,
          totalQuestions: 4,
          question,
          options: [
            { optionId: 'o1', text: 'Ottawa' },
            { optionId: 'o2', text: 'Maple City' },
            { optionId: 'o3', text: 'Moose Town' },
          ],
          reveal: null,
        },
      }),
    );
    expect(screen.getByText('Maple City')).not.toBeNull();
    expect(screen.getByText('C')).not.toBeNull();
  });

  it('reveals the truth last, credits the liars and names who was fooled', () => {
    const { container } = renderHost(
      roomState({
        phase: 'results',
        gameType: 'bluff',
        players: THREE,
        bluff: {
          questionIndex: 0,
          totalQuestions: 4,
          question,
          options: null,
          reveal: {
            options: [
              { optionId: 'o1', text: 'Ottawa', isTruth: true, authors: [], pickers: [{ name: 'P3', avatar: 'fox' }] },
              {
                optionId: 'o2',
                text: 'Maple City',
                isTruth: false,
                authors: [{ name: 'P1', avatar: 'fox' }],
                pickers: [{ name: 'P2', avatar: 'cat' }],
              },
              { optionId: 'o3', text: 'Moose Town', isTruth: false, authors: [], pickers: [] },
            ],
            pointsThisRound: [
              { playerId: 'p1', playerName: 'P1', points: 250 },
              { playerId: 'p3', playerName: 'P3', points: 500 },
              { playerId: 'p2', playerName: 'P2', points: 0 },
            ],
          },
        },
      }),
    );
    const cards = [...container.querySelectorAll('.bluff-option')];
    expect(cards.at(-1)?.textContent).toMatch(/Ottawa/);
    expect(cards.at(-1)?.classList.contains('truth')).toBe(true);
    expect(screen.getByText('Lie by P1')).not.toBeNull();
    expect(screen.getByText('House lie')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'Votes from P2' })).not.toBeNull();
    expect(screen.getByText('P3 +500')).not.toBeNull();
    expect(screen.queryByText(/P2 \+0/)).toBeNull();
  });
});

describe('HostScreen scoreboard extras', () => {
  it('shows the highlights, session standings and a share button', () => {
    renderHost(
      roomState({
        phase: 'scoreboard',
        gameType: 'quiplash',
        players: [
          player('p1', { score: 900, sessionScore: 1_500, wins: 1 }),
          player('p2', { score: 300, sessionScore: 2_000, wins: 1 }),
          player('p3', { score: 100, sessionScore: 100 }),
        ],
        gamesPlayed: 2,
        highlights: [
          { kind: 'quip', prompt: 'A bad name for a boat', text: 'Titanic II', authors: [{ name: 'P1', avatar: 'fox' }], votes: 5 },
        ],
      }),
    );
    const highlights = screen.getByRole('region', { name: /best of the game/i });
    expect(within(highlights).getByText('“Titanic II”')).not.toBeNull();
    expect(within(highlights).getByText(/Votes: 5/)).not.toBeNull();

    const standings = screen.getByRole('region', { name: /session standings/i });
    const rows = within(standings).getAllByRole('listitem');
    expect(rows[0].textContent).toMatch(/P2.*2000/);
    expect(rows[2].textContent).toMatch(/P3/);
    expect(screen.getByRole('button', { name: /share results/i })).not.toBeNull();
  });

  it('hides session standings after the first game', () => {
    renderHost(roomState({ phase: 'gameover', gameType: 'trivia', players: THREE, gamesPlayed: 1, highlights: [] }));
    expect(screen.queryByRole('region', { name: /session standings/i })).toBeNull();
    expect(screen.queryByRole('region', { name: /best of the game/i })).toBeNull();
  });
});

describe('HostScreen custom questions', () => {
  beforeEach(() => emitAck.mockReset().mockResolvedValue({ ok: true, data: { count: 1 } }));

  const openQuestions = async (user: ReturnType<typeof userEvent.setup>, state = roomState({ players: THREE })) => {
    renderHost(state);
    await user.click(screen.getByRole('button', { name: /^trivia/i }));
    await user.click(screen.getByRole('button', { name: /custom questions/i }));
    return screen.getByLabelText(/custom questions/i);
  };

  it('offers the question pack for trivia and bluff, and the prompt pack only for quiplash', async () => {
    const user = userEvent.setup();
    renderHost(roomState({ players: THREE }));
    expect(screen.queryByRole('button', { name: /custom questions/i })).toBeNull();
    expect(screen.getByRole('button', { name: /custom prompts/i })).not.toBeNull();

    await user.click(screen.getByRole('button', { name: /^trivia/i }));
    expect(screen.getByRole('button', { name: /custom questions/i })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /custom prompts/i })).toBeNull();

    await user.click(screen.getByRole('button', { name: /bluff/i }));
    expect(screen.getByRole('button', { name: /custom questions/i })).not.toBeNull();
  });

  it('saves each valid line in a normalised form, skipping blank ones', async () => {
    const user = userEvent.setup();
    const input = await openQuestions(user);
    await user.click(input);
    await user.paste('  Q1? |A|  B | C|D  \n\nQ2? | 1 | 2 | 3 | 4');
    await user.click(screen.getByRole('button', { name: /save questions/i }));
    expect(emitAck).toHaveBeenCalledWith('room:setCustomQuestions', {
      questions: ['Q1? | A | B | C | D', 'Q2? | 1 | 2 | 3 | 4'],
      phaseId: 1,
    });
  });

  it('accepts a row pasted from a spreadsheet', async () => {
    const user = userEvent.setup();
    const input = await openQuestions(user);
    await user.click(input);
    await user.paste('Capital of France?\tParis\tRome\tMadrid\tBerlin\t');
    await user.click(screen.getByRole('button', { name: /save questions/i }));
    expect(emitAck).toHaveBeenCalledWith('room:setCustomQuestions', {
      questions: ['Capital of France? | Paris | Rome | Madrid | Berlin'],
      phaseId: 1,
    });
  });

  it('names the first unusable line and holds Save back until it is fixed', async () => {
    const user = userEvent.setup();
    const input = await openQuestions(user);
    await user.click(input);
    await user.paste('Q1? | A | B | C | D\nQ2? | only | two');
    expect(screen.getByRole('status').textContent).toMatch(/line 2 can't be used/i);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const save = screen.getByRole('button', { name: /save questions/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    await user.clear(input);
    await user.paste('Q1? | A | B | C | D');
    expect(screen.queryByRole('status')).toBeNull();
    expect(save.disabled).toBe(false);
  });

  it('flags a repeated answer and an over-long one the way the server would', async () => {
    const user = userEvent.setup();
    const input = await openQuestions(user);
    await user.click(input);
    await user.paste('Q? | Paris | Rome | paris! | Berlin');
    expect(screen.getByRole('status').textContent).toMatch(/line 1/i);

    await user.clear(input);
    await user.paste(`Q? | ${'x'.repeat(41)} | B | C | D`);
    expect(screen.getByRole('status').textContent).toMatch(/line 1/i);
  });

  it('refuses a pack larger than the server accepts', async () => {
    const user = userEvent.setup();
    const input = await openQuestions(user);
    await user.click(input);
    await user.paste(Array.from({ length: MAX_CUSTOM_QUESTIONS + 1 }, (_, i) => `Q${i}? | A | B | C | D`).join('\n'));
    expect(screen.getByText(`${MAX_CUSTOM_QUESTIONS + 1}/${MAX_CUSTOM_QUESTIONS}`)).not.toBeNull();
    expect((screen.getByRole('button', { name: /save questions/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows how many questions are loaded and can clear them', async () => {
    const user = userEvent.setup();
    renderHost(roomState({ players: THREE, customQuestionCount: 3 }));
    await user.click(screen.getByRole('button', { name: /^trivia/i }));
    await user.click(screen.getByRole('button', { name: /custom questions in play: 3/i }));
    await user.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(emitAck).toHaveBeenCalledWith('room:setCustomQuestions', { questions: [], phaseId: 1 });
  });
});
