import { randomUUID } from "node:crypto";
import {
  TRIVIA_FINAL_MULTIPLIER,
  TRIVIA_QUESTIONS,
} from "../../../shared/src/index.js";
import type { TriviaView } from "../../../shared/src/index.js";
import type { EngineContext, EngineView, GameEngine } from "../engine.js";
import { pickTrivia, type TriviaQuestion } from "../content/trivia.js";

const QUESTION_SECONDS = 20;
const RESULTS_SECONDS = 7;
const BASE_POINTS = 500;
const SPEED_BONUS = 500;
const STREAK_BONUS = 100;

interface LoadedQuestion extends TriviaQuestion {
  id: string;
}

interface PlayerAnswer {
  optionIndex: number;
  elapsedMs: number;
}

export class TriviaEngine implements GameEngine {
  readonly type = "trivia" as const;

  private questions: LoadedQuestion[] = [];
  private index = 0;
  private questionStart = 0;
  private answers = new Map<string, PlayerAnswer>();
  private revealed = false;
  private lastReveal: NonNullable<TriviaView["reveal"]> | null = null;

  constructor(
    private ctx: EngineContext,
    private questionCount = TRIVIA_QUESTIONS
  ) {}

  start(): void {
    this.questions = pickTrivia(this.ctx.language, this.questionCount).map((q) => ({
      ...q,
      id: randomUUID(),
    }));
    this.index = 0;
    this.beginQuestion();
  }

  private beginQuestion(): void {
    this.answers.clear();
    this.revealed = false;
    this.lastReveal = null;
    this.questionStart = this.ctx.now();
    this.ctx.resetFlags();
    this.ctx.setPhase("answering", QUESTION_SECONDS, () => this.reveal());
  }

  handleTriviaAnswer(
    playerId: string,
    questionId: string,
    optionIndex: number
  ): boolean {
    if (this.revealed) return false;
    const q = this.questions[this.index];
    if (!q || q.id !== questionId) return false;
    const player = this.ctx.getPlayer(playerId);
    if (!player) return false;
    if (this.answers.has(playerId)) return false; // locked in
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= q.options.length)
      return false;

    this.answers.set(playerId, {
      optionIndex,
      elapsedMs: this.ctx.now() - this.questionStart,
    });
    player.hasSubmitted = true;
    this.ctx.emit();

    // Reveal as soon as every connected player has answered; disconnected
    // players are skipped rather than stalling the question until the timer.
    if (this.ctx.players().every((p) => !p.connected || p.hasSubmitted))
      this.reveal();
    return true;
  }

  /** A participant was kicked: drop their pending answer, then re-check. */
  handlePlayerRemoved(playerId: string): void {
    this.answers.delete(playerId);
    this.handlePlayerDisconnect();
  }

  /** Re-check completion when a player drops (see GameEngine). */
  handlePlayerDisconnect(): void {
    if (this.revealed) return;
    // Never fast-forward an abandoned room; the idle sweep will reclaim it.
    if (!this.ctx.players().some((p) => p.connected)) return;
    if (this.ctx.players().every((p) => !p.connected || p.hasSubmitted))
      this.reveal();
  }

  private reveal(): void {
    if (this.revealed) return;
    this.revealed = true;
    const q = this.questions[this.index];
    const isLast = this.index >= this.questions.length - 1;
    const counts = new Array(q.options.length).fill(0);
    const pointsThisRound: {
      playerId: string;
      playerName: string;
      points: number;
    }[] = [];

    for (const player of this.ctx.players()) {
      const ans = this.answers.get(player.id);
      if (ans) counts[ans.optionIndex] += 1;

      let points = 0;
      if (ans && ans.optionIndex === q.correctIndex) {
        const timeRatio = Math.max(
          0,
          1 - ans.elapsedMs / (QUESTION_SECONDS * 1000)
        );
        player.streak += 1;
        points =
          BASE_POINTS +
          Math.round(SPEED_BONUS * timeRatio) +
          (player.streak - 1) * STREAK_BONUS;
        // The final question is worth double — comebacks stay possible.
        if (isLast) points *= TRIVIA_FINAL_MULTIPLIER;
      } else {
        player.streak = 0;
      }
      if (points > 0) this.ctx.award(player.id, points);
      pointsThisRound.push({
        playerId: player.id,
        playerName: player.name,
        points,
      });
    }

    this.lastReveal = {
      correctIndex: q.correctIndex,
      counts,
      pointsThisRound: pointsThisRound.sort((a, b) => b.points - a.points),
    };

    this.ctx.setPhase("results", RESULTS_SECONDS, () => {
      if (isLast) {
        this.ctx.toScoreboard(15);
      } else {
        this.index += 1;
        this.beginQuestion();
      }
    });
  }

  serialize(): EngineView {
    const q = this.questions[this.index];
    return {
      round: this.index + 1,
      totalRounds: this.questions.length,
      trivia: {
        questionIndex: this.index,
        totalQuestions: this.questions.length,
        question: q ? { id: q.id, text: q.text, options: q.options } : null,
        reveal: this.revealed ? this.lastReveal : null,
      },
    };
  }

  dispose(): void {}
}
