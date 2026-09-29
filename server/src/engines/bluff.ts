import { randomInt, randomUUID } from "node:crypto";
import type {
  ApiErrorCode,
  BluffOptionReveal,
  BluffView,
  Credit,
  Highlight,
  PlayerAssignment,
} from "../../../shared/src/index.js";
import {
  answerKey,
  BLUFF_FOOL_POINTS,
  BLUFF_QUESTIONS,
  BLUFF_TRUTH_POINTS,
  looseAnswerKey,
  TRIVIA_FINAL_MULTIPLIER,
} from "../../../shared/src/index.js";
import type {
  EngineContext,
  EngineSnapshot,
  EngineView,
  GameEngine,
} from "../engine.js";
import { pickTrivia, type TriviaQuestion } from "../content/trivia.js";

// Lives in shared/ so the host's pack editor can flag repeated answers the way
// this engine would; tests and callers still import it from here.
export { answerKey };

const WRITE_SECONDS = 45;
const PICK_SECONDS = 25;
const RESULTS_SECONDS = 10;
/** The truth plus at least two lies, topped up from the house if needed. */
const MIN_OPTIONS = 3;
const HIGHLIGHT_COUNT = 3;

interface BluffQuestion {
  id: string;
  text: string;
  truth: string;
  /** The trivia question's wrong answers, used when players write too few lies. */
  decoys: string[];
}

interface BluffOption {
  optionId: string;
  text: string;
  isTruth: boolean;
  /** Empty for the truth and for house decoys. */
  authorIds: string[];
}

type Stage = "idle" | "writing" | "picking" | "reveal";

interface LieCandidate {
  prompt: string;
  text: string;
  authors: Credit[];
  fooled: number;
}

/** Everything `BluffEngine` needs to be rebuilt after a restart. */
interface BluffSnapshot {
  questionCount: number;
  avoidQuestions: string[];
  questions: BluffQuestion[];
  index: number;
  stage: Stage;
  lies: [string, string][];
  options: BluffOption[] | null;
  picks: [string, string][];
  lastReveal: BluffView["reveal"];
  candidates: LieCandidate[];
}

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Bluff: everyone writes a believable fake answer to a trivia question, then
 * hunts for the real one among all the lies. Finding the truth scores, and so
 * does every player your lie fools. Reuses the trivia pool, so every language
 * gets the mode without a content pack of its own.
 */
export class BluffEngine implements GameEngine {
  readonly type = "bluff" as const;

  private questions: BluffQuestion[] = [];
  private index = 0;
  private stage: Stage = "idle";
  private lies = new Map<string, string>();
  private options: BluffOption[] | null = null;
  private picks = new Map<string, string>();
  private lastReveal: BluffView["reveal"] = null;
  private candidates: LieCandidate[] = [];

  constructor(
    private ctx: EngineContext,
    private questionCount = BLUFF_QUESTIONS,
    private avoidQuestions: ReadonlySet<string> = new Set(),
    private recordQuestion: (question: string) => void = () => {},
    private customQuestions: readonly TriviaQuestion[] = [],
  ) {}

  start(): void {
    this.questions = pickTrivia(
      this.ctx.language,
      this.questionCount,
      this.avoidQuestions,
      this.customQuestions,
    ).map((q) => {
      this.recordQuestion(q.text);
      return {
        id: randomUUID(),
        text: q.text,
        truth: q.options[q.correctIndex],
        decoys: q.options.filter((_, i) => i !== q.correctIndex),
      };
    });
    this.index = 0;
    this.beginQuestion();
  }

  private get question(): BluffQuestion | undefined {
    return this.questions[this.index];
  }

  private beginQuestion(): void {
    this.stage = "writing";
    this.lies.clear();
    this.picks.clear();
    this.options = null;
    this.lastReveal = null;
    this.ctx.resetFlags();
    this.sendAssignments();
    this.ctx.setPhase("answering", WRITE_SECONDS, () => this.beginPicking());
  }

  private sendAssignments(): void {
    for (const player of this.ctx.connectedPlayers()) {
      const assignment = this.currentAssignment(player.id);
      if (assignment) this.ctx.sendAssignment(player.id, assignment);
    }
  }

  handleLie(playerId: string, questionId: string, text: string): ApiErrorCode | null {
    const q = this.question;
    if (this.stage !== "writing" || !q || q.id !== questionId) return "submit_failed";
    const player = this.ctx.getPlayer(playerId);
    if (!player || this.lies.has(playerId)) return "submit_failed";
    // The socket layer already sanitized and bounded the text.
    if (!text.trim()) return "submit_failed";
    // Telling the player is the point: they now know the truth and must lie.
    if (looseAnswerKey(text) === looseAnswerKey(q.truth)) return "answer_is_truth";

    this.lies.set(playerId, text);
    player.hasSubmitted = true;
    this.ctx.emit();
    this.ctx.sendAssignment(playerId, this.assignmentFor(playerId, q));
    if (this.ctx.players().every((p) => !p.connected || p.hasSubmitted)) {
      this.beginPicking();
    }
    return null;
  }

  private beginPicking(): void {
    const q = this.question;
    if (this.stage !== "writing" || !q) return;
    this.stage = "picking";

    // Identical lies merge into one option credited to every author, so the
    // board never shows the same text twice and both authors share the fools.
    const byKey = new Map<string, BluffOption>();
    for (const [playerId, text] of this.lies) {
      const key = looseAnswerKey(text);
      const existing = byKey.get(key);
      if (existing) existing.authorIds.push(playerId);
      else byKey.set(key, { optionId: randomUUID(), text, isTruth: false, authorIds: [playerId] });
    }
    const options: BluffOption[] = [
      { optionId: randomUUID(), text: q.truth, isTruth: true, authorIds: [] },
      ...byKey.values(),
    ];
    for (const decoy of shuffled(q.decoys)) {
      if (options.length >= MIN_OPTIONS) break;
      const key = looseAnswerKey(decoy);
      if (options.some((option) => looseAnswerKey(option.text) === key)) continue;
      options.push({ optionId: randomUUID(), text: decoy, isTruth: false, authorIds: [] });
    }
    this.options = shuffled(options);

    this.ctx.resetFlags();
    this.sendAssignments();
    this.ctx.setPhase("voting", PICK_SECONDS, () => this.reveal());
  }

  handlePick(playerId: string, questionId: string, optionId: string): boolean {
    const q = this.question;
    if (this.stage !== "picking" || !q || q.id !== questionId || !this.options) {
      return false;
    }
    const player = this.ctx.getPlayer(playerId);
    if (!player || this.picks.has(playerId)) return false;
    const option = this.options.find((o) => o.optionId === optionId);
    if (!option || option.authorIds.includes(playerId)) return false;

    this.picks.set(playerId, optionId);
    player.hasVoted = true;
    this.ctx.emit();
    // The reveal names pickers only by display name; the private channel is
    // how a phone knows which option was its own pick.
    this.ctx.sendAssignment(playerId, this.assignmentFor(playerId, q));
    if (this.ctx.players().every((p) => !p.connected || p.hasVoted)) this.reveal();
    return true;
  }

  private reveal(): void {
    const q = this.question;
    if (this.stage !== "picking" || !q || !this.options) return;
    this.stage = "reveal";
    const multiplier =
      this.index >= this.questions.length - 1 ? TRIVIA_FINAL_MULTIPLIER : 1;
    const earned = new Map<string, number>();
    const add = (id: string, points: number) =>
      earned.set(id, (earned.get(id) ?? 0) + points);

    const pickersOf = new Map<string, string[]>();
    for (const [pickerId, optionId] of this.picks) {
      const option = this.options.find((o) => o.optionId === optionId);
      if (!option) continue;
      pickersOf.set(optionId, [...(pickersOf.get(optionId) ?? []), pickerId]);
      if (option.isTruth) add(pickerId, BLUFF_TRUTH_POINTS * multiplier);
      else for (const authorId of option.authorIds) add(authorId, BLUFF_FOOL_POINTS * multiplier);
    }

    const credits = (ids: readonly string[]): Credit[] =>
      ids.flatMap((id) => {
        const person = this.ctx.getParticipant(id);
        return person ? [{ name: person.name, avatar: person.avatar }] : [];
      });

    const options: BluffOptionReveal[] = this.options.map((option) => ({
      optionId: option.optionId,
      text: option.text,
      isTruth: option.isTruth,
      authors: credits(option.authorIds),
      pickers: credits(pickersOf.get(option.optionId) ?? []),
    }));
    for (const option of options) {
      if (!option.isTruth && option.authors.length > 0 && option.pickers.length > 0) {
        this.candidates.push({
          prompt: q.text,
          text: option.text,
          authors: option.authors,
          fooled: option.pickers.length,
        });
      }
    }

    const pointsThisRound = this.ctx.players().map((player) => {
      const points = earned.get(player.id) ?? 0;
      if (points > 0) this.ctx.award(player.id, points);
      return { playerId: player.id, playerName: player.name, points };
    });
    this.lastReveal = {
      options,
      pointsThisRound: pointsThisRound.sort((a, b) => b.points - a.points),
    };
    this.ctx.setPhase("results", RESULTS_SECONDS, () => this.afterReveal());
  }

  private afterReveal(): void {
    if (this.index >= this.questions.length - 1) {
      this.ctx.toScoreboard(15);
    } else {
      this.index += 1;
      this.beginQuestion();
    }
  }

  private assignmentFor(playerId: string, q: BluffQuestion): PlayerAssignment {
    return {
      prompts: [],
      votedMatchupId: null,
      bluff: {
        questionId: q.id,
        submitted: this.lies.has(playerId),
        ownOptionIds: (this.options ?? [])
          .filter((option) => option.authorIds.includes(playerId))
          .map((option) => option.optionId),
        pickedOptionId: this.picks.get(playerId) ?? null,
      },
    };
  }

  /** Re-sendable after a reconnect: which option is the player's own lie. */
  currentAssignment(playerId: string): PlayerAssignment | null {
    const q = this.question;
    if (!q || (this.stage !== "writing" && this.stage !== "picking")) return null;
    if (!this.ctx.getPlayer(playerId)) return null;
    return this.assignmentFor(playerId, q);
  }

  /** A participant was kicked: their lie stays as a pointless decoy. */
  handlePlayerRemoved(playerId: string): void {
    this.lies.delete(playerId);
    this.picks.delete(playerId);
    for (const option of this.options ?? []) {
      option.authorIds = option.authorIds.filter((id) => id !== playerId);
    }
    this.handlePlayerDisconnect();
  }

  handlePlayerDisconnect(): void {
    // Never fast-forward an abandoned room; the idle sweep will reclaim it.
    if (!this.ctx.players().some((p) => p.connected)) return;
    if (
      this.stage === "writing" &&
      this.ctx.players().every((p) => !p.connected || p.hasSubmitted)
    ) {
      this.beginPicking();
    } else if (
      this.stage === "picking" &&
      this.ctx.players().every((p) => !p.connected || p.hasVoted)
    ) {
      this.reveal();
    }
  }

  highlights(): Highlight[] {
    return [...this.candidates]
      .sort((a, b) => b.fooled - a.fooled)
      .slice(0, HIGHLIGHT_COUNT)
      .map(({ prompt, text, authors, fooled }) => ({
        kind: "lie",
        prompt,
        text,
        authors,
        votes: fooled,
      }));
  }

  serialize(): EngineView {
    const q = this.question;
    const showOptions = this.stage === "picking" || this.stage === "reveal";
    return {
      round: this.index + 1,
      totalRounds: this.questions.length,
      bluff: {
        questionIndex: this.index,
        totalQuestions: this.questions.length,
        question: q ? { id: q.id, text: q.text } : null,
        options:
          showOptions && this.options
            ? this.options.map(({ optionId, text }) => ({ optionId, text }))
            : null,
        reveal: this.stage === "reveal" ? this.lastReveal : null,
      },
    };
  }

  timeoutHandler(): (() => void) | null {
    if (this.stage === "writing") return () => this.beginPicking();
    if (this.stage === "picking") return () => this.reveal();
    if (this.stage === "reveal") return () => this.afterReveal();
    return null;
  }

  snapshot(): EngineSnapshot {
    const data: BluffSnapshot = {
      questionCount: this.questionCount,
      avoidQuestions: [...this.avoidQuestions],
      questions: this.questions,
      index: this.index,
      stage: this.stage,
      lies: [...this.lies],
      options: this.options,
      picks: [...this.picks],
      lastReveal: this.lastReveal,
      candidates: this.candidates,
    };
    return { type: "bluff", data };
  }

  /** Rebuild a game from `snapshot()`; the room re-arms its phase timer. */
  static restore(
    ctx: EngineContext,
    raw: unknown,
    recordQuestion: (question: string) => void = () => {},
  ): BluffEngine {
    const data = raw as BluffSnapshot;
    const engine = new BluffEngine(
      ctx,
      data.questionCount,
      new Set(data.avoidQuestions),
      recordQuestion,
    );
    engine.questions = data.questions;
    engine.index = data.index;
    engine.stage = data.stage;
    engine.lies = new Map(data.lies);
    engine.options = data.options;
    engine.picks = new Map(data.picks);
    engine.lastReveal = data.lastReveal;
    engine.candidates = data.candidates;
    return engine;
  }

  dispose(): void {
    this.stage = "idle";
  }
}
