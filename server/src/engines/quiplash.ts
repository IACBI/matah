import { randomUUID } from "node:crypto";
import type { Matchup, MatchupResult } from "../../../shared/src/index.js";
import { DEFAULT_TOTAL_ROUNDS, MAX_ANSWER_LEN } from "../../../shared/src/index.js";
import type { EngineContext, EngineView, GameEngine } from "../engine.js";
import { pickPrompts } from "../content/prompts.js";

const ANSWER_SECONDS = 60;
const VOTE_SECONDS = 20;
const RESULTS_SECONDS = 9;

export class QuiplashEngine implements GameEngine {
  readonly type = "quiplash" as const;

  private round = 0;
  private totalRounds = DEFAULT_TOTAL_ROUNDS;
  private matchups: Matchup[] = [];
  private matchupAuthors: string[][] = [];
  private currentMatchupIndex = 0;
  private lastResults: MatchupResult[] | null = null;
  private votingActive = false;

  constructor(private ctx: EngineContext) {}

  start(): void {
    this.round = 0;
    this.beginRound();
  }

  private beginRound(): void {
    this.round += 1;
    this.lastResults = null;
    const players = this.ctx.players();
    const n = players.length;
    const prompts = pickPrompts(this.ctx.language, n);

    this.matchups = prompts.map((prompt) => ({
      id: randomUUID(),
      prompt,
      answers: [],
      votes: {},
    }));
    // Cyclic pairing: matchup i is answered by player i and player i+1.
    this.matchupAuthors = this.matchups.map((_, i) => [
      players[i].id,
      players[(i + 1) % n].id,
    ]);

    this.ctx.resetFlags();

    for (const player of players) {
      this.ctx.sendAssignment(player.id, this.assignmentFor(player.id));
    }

    this.ctx.setPhase("answering", ANSWER_SECONDS, () => this.beginVoting());
  }

  /** The prompts a player is responsible for this round. */
  private assignmentFor(playerId: string) {
    const prompts = this.matchupAuthors
      .map((authors, mi) =>
        authors.includes(playerId)
          ? { matchupId: this.matchups[mi].id, prompt: this.matchups[mi].prompt }
          : null
      )
      .filter((x): x is { matchupId: string; prompt: string } => x !== null);
    return { prompts };
  }

  /** Re-sendable assignment for reconnects (only meaningful while answering). */
  currentAssignment(playerId: string) {
    if (!this.votingActive && this.matchups.length > 0) {
      return this.assignmentFor(playerId);
    }
    return null;
  }

  handleAnswer(playerId: string, matchupId: string, text: string): boolean {
    const mi = this.matchups.findIndex((m) => m.id === matchupId);
    if (mi === -1) return false;
    const player = this.ctx.getPlayer(playerId);
    if (!player) return false;
    if (!this.matchupAuthors[mi].includes(playerId)) return false;
    const matchup = this.matchups[mi];
    if (matchup.answers.some((a) => a.playerId === playerId)) return false;

    matchup.answers.push({
      playerId,
      playerName: player.name,
      text: text.trim().slice(0, MAX_ANSWER_LEN) || "…",
    });

    const assignedCount = this.matchupAuthors.filter((a) =>
      a.includes(playerId)
    ).length;
    const answeredCount = this.matchups.filter((m) =>
      m.answers.some((a) => a.playerId === playerId)
    ).length;
    player.hasSubmitted = answeredCount >= assignedCount;

    this.ctx.emit();
    // A disconnected player can't act, so don't let them stall the round:
    // advance as soon as every still-connected player has answered.
    if (this.ctx.players().every((p) => !p.connected || p.hasSubmitted))
      this.beginVoting();
    return true;
  }

  private beginVoting(): void {
    this.currentMatchupIndex = -1;
    this.advanceMatchup();
  }

  private advanceMatchup(): void {
    this.currentMatchupIndex += 1;
    while (
      this.currentMatchupIndex < this.matchups.length &&
      this.matchups[this.currentMatchupIndex].answers.length < 2
    ) {
      this.currentMatchupIndex += 1;
    }
    if (this.currentMatchupIndex >= this.matchups.length) {
      this.beginResults();
      return;
    }
    this.ctx.resetFlags();
    this.votingActive = true;
    this.ctx.setPhase("voting", VOTE_SECONDS, () => this.advanceMatchup());
  }

  handleVote(playerId: string, matchupId: string, answerPlayerId: string): boolean {
    const matchup = this.matchups[this.currentMatchupIndex];
    if (!matchup || matchup.id !== matchupId) return false;
    const player = this.ctx.getPlayer(playerId);
    if (!player) return false;
    const authors = this.matchupAuthors[this.currentMatchupIndex];
    if (authors.includes(playerId)) return false; // can't vote your own
    if (matchup.votes[playerId]) return false; // already voted
    if (!matchup.answers.some((a) => a.playerId === answerPlayerId)) return false;

    matchup.votes[playerId] = answerPlayerId;
    player.hasVoted = true;
    this.ctx.emit();

    // Only wait on connected, non-author voters — disconnected players are
    // skipped so they can't hold up the matchup.
    const eligible = this.ctx
      .players()
      .filter((p) => p.connected && !authors.includes(p.id));
    if (eligible.every((p) => p.hasVoted)) this.advanceMatchup();
    return true;
  }

  private beginResults(): void {
    const results: MatchupResult[] = [];
    for (const matchup of this.matchups) {
      if (matchup.answers.length < 2) continue;
      const counts: Record<string, number> = {};
      for (const a of matchup.answers) counts[a.playerId] = 0;
      for (const voted of Object.values(matchup.votes)) {
        if (counts[voted] !== undefined) counts[voted] += 1;
      }
      results.push({
        prompt: matchup.prompt,
        answers: matchup.answers.map((a) => {
          const votes = counts[a.playerId] ?? 0;
          const pointsAwarded = votes * 100 * this.round;
          this.ctx.award(a.playerId, pointsAwarded);
          return { ...a, votes, pointsAwarded };
        }),
      });
    }
    this.lastResults = results;
    this.votingActive = false;

    const isLast = this.round >= this.totalRounds;
    this.ctx.setPhase("results", RESULTS_SECONDS, () =>
      isLast ? this.ctx.toScoreboard(15) : this.beginRound()
    );
  }

  serialize(): EngineView {
    const active = this.matchups[this.currentMatchupIndex];
    return {
      round: this.round,
      totalRounds: this.totalRounds,
      quiplash: {
        currentMatchupIndex: Math.max(0, this.currentMatchupIndex),
        totalMatchups: this.matchups.length,
        activeMatchup: active && this.votingActive
          ? {
              id: active.id,
              prompt: active.prompt,
              answers: active.answers.map((a) => ({ ...a })),
            }
          : null,
        lastResults: this.lastResults,
      },
    };
  }

  dispose(): void {}
}
