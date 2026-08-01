import { randomUUID } from "node:crypto";
import type {
  Matchup,
  MatchupResult,
  PlayerAssignment,
} from "../../../shared/src/index.js";
import {
  DEFAULT_TOTAL_ROUNDS,
  MATCHUP_POINT_POOL,
  SUBMIT_BONUS,
} from "../../../shared/src/index.js";
import type { EngineContext, EngineView, GameEngine } from "../engine.js";
import { pickPromptsForSlots, pickSafetyAnswer } from "../content/prompts.js";

const ANSWER_SECONDS = 60;
const VOTE_SECONDS = 20;
const MIN_VOTE_DISPLAY_SECONDS = 3;
const RESULTS_SECONDS = 9;

export class QuiplashEngine implements GameEngine {
  readonly type = "quiplash" as const;

  private round = 0;
  private totalRounds: number;
  private matchups: Matchup[] = [];
  private matchupAuthors: string[][] = [];
  private currentMatchupIndex = 0;
  private lastResults: MatchupResult[] | null = null;
  private votingActive = false;
  private answeringActive = false;
  private voteMinHandle: NodeJS.Timeout | null = null;
  private votingStartedAt = 0;
  /**
   * Who may gate the early advance for the active matchup, captured when it
   * opens. Someone who joins or reconnects mid-vote may still vote, but must
   * not hold the room on a 20-second timer they were never part of.
   */
  private eligibleVoterIds = new Set<string>();
  /** How many matchups each player authors this round (see handleAnswer). */
  private assignedCount = new Map<string, number>();
  private answeredCount = new Map<string, number>();

  private usedPrompts = new Set<string>();
  /** prompt -> players who have already written for it, across the game. */
  private promptSeenBy = new Map<string, Set<string>>();

  constructor(
    private ctx: EngineContext,
    rounds = DEFAULT_TOTAL_ROUNDS,
    private avoidPrompts: ReadonlySet<string> = new Set(),
    private recordPrompt: (prompt: string) => void = () => {},
  ) {
    this.totalRounds = rounds;
  }

  start(): void {
    this.round = 0;
    this.beginRound();
  }

  private beginRound(): void {
    this.round += 1;
    this.lastResults = null;
    this.currentMatchupIndex = 0;
    // Size the round by who is actually online. Handing prompts to a player
    // who is holding a disconnect lease only publishes a canned safety quip
    // under their name.
    const players = this.ctx.connectedPlayers();
    const n = players.length;

    // Pair first, then choose prompts, so selection can see who will author
    // each one. Cyclic pairing: matchup i is written by player i and i+1.
    this.matchupAuthors = players.map((_, i) => [
      players[i].id,
      players[(i + 1) % n].id,
    ]);
    const prompts = pickPromptsForSlots(
      this.ctx.language,
      this.matchupAuthors.map((authors) => ({ authors })),
      new Set([...this.avoidPrompts, ...this.usedPrompts]),
      this.promptSeenBy,
    );

    this.matchups = prompts.map((prompt, i) => {
      this.usedPrompts.add(prompt);
      this.recordPrompt(prompt);
      const seen = this.promptSeenBy.get(prompt) ?? new Set<string>();
      for (const authorId of this.matchupAuthors[i]) seen.add(authorId);
      this.promptSeenBy.set(prompt, seen);
      return { id: randomUUID(), prompt, answers: [], votes: {} };
    });

    this.assignedCount.clear();
    this.answeredCount.clear();
    for (const authors of this.matchupAuthors) {
      for (const id of authors) {
        this.assignedCount.set(id, (this.assignedCount.get(id) ?? 0) + 1);
      }
    }

    this.ctx.resetFlags();
    this.answeringActive = true;

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
          ? {
              matchupId: this.matchups[mi].id,
              prompt: this.matchups[mi].prompt,
              submitted: this.matchups[mi].answers.some(
                (answer) => answer.playerId === playerId && !answer.isSafety,
              ),
            }
          : null
      )
      .filter((x): x is PlayerAssignment["prompts"][number] => x !== null);
    return { prompts };
  }

  /** Re-sendable assignment also identifies authors during anonymous voting. */
  currentAssignment(playerId: string) {
    if ((this.answeringActive || this.votingActive) && this.matchups.length > 0) {
      return this.assignmentFor(playerId);
    }
    return null;
  }

  handleAnswer(playerId: string, matchupId: string, text: string): boolean {
    if (!this.answeringActive) return false;
    const mi = this.matchups.findIndex((m) => m.id === matchupId);
    if (mi === -1) return false;
    const player = this.ctx.getPlayer(playerId);
    if (!player) return false;
    if (!this.matchupAuthors[mi].includes(playerId)) return false;
    const matchup = this.matchups[mi];
    if (matchup.answers.some((a) => a.playerId === playerId)) return false;
    // The socket layer already sanitized and bounded this by code point, so
    // truncating again here would only risk splitting a surrogate pair. An
    // empty answer is a rejection, not a scoreable "…" that can win votes.
    if (!text.trim()) return false;

    matchup.answers.push({
      answerId: randomUUID(),
      playerId,
      playerName: player.name,
      text,
      isSafety: false,
    });

    const answered = (this.answeredCount.get(playerId) ?? 0) + 1;
    this.answeredCount.set(playerId, answered);
    player.hasSubmitted = answered >= (this.assignedCount.get(playerId) ?? 0);

    this.ctx.emit();
    // A disconnected player can't act, so don't let them stall the round:
    // advance as soon as every still-connected player has answered.
    if (this.ctx.players().every((p) => !p.connected || p.hasSubmitted))
      this.beginVoting();
    return true;
  }

  private beginVoting(): void {
    if (!this.answeringActive) return;
    this.answeringActive = false;
    this.fillSafetyAnswers();
    this.currentMatchupIndex = -1;
    this.advanceMatchup();
  }

  /**
   * "Safety quips": authors who ran out of time get a canned funny answer so
   * their matchup stays votable instead of being skipped.
   */
  private fillSafetyAnswers(): void {
    for (const [mi, matchup] of this.matchups.entries()) {
      for (const authorId of this.matchupAuthors[mi]) {
        if (matchup.answers.some((a) => a.playerId === authorId)) continue;
        const author = this.ctx.getPlayer(authorId);
        if (!author) continue;
        matchup.answers.push({
          answerId: randomUUID(),
          playerId: authorId,
          playerName: author.name,
          text: pickSafetyAnswer(this.ctx.language),
          isSafety: true,
        });
      }
    }
  }

  private advanceMatchup(): void {
    this.clearVoteMinTimer();
    this.votingActive = false;
    this.currentMatchupIndex += 1;
    // Skip matchups that can't be voted on: not enough answers, all canned,
    // or nobody connected who is allowed to vote. (eligibleVoters already
    // includes the audience.)
    while (
      this.currentMatchupIndex < this.matchups.length &&
      (this.matchups[this.currentMatchupIndex].answers.length < 2 ||
        this.matchups[this.currentMatchupIndex].answers.every((a) => a.isSafety) ||
        this.eligibleVoters(this.matchupAuthors[this.currentMatchupIndex]).length === 0)
    ) {
      this.currentMatchupIndex += 1;
    }
    if (this.currentMatchupIndex >= this.matchups.length) {
      this.beginResults();
      return;
    }
    this.ctx.resetFlags();
    this.votingActive = true;
    this.votingStartedAt = this.ctx.now();
    this.eligibleVoterIds = new Set(
      this.eligibleVoters(this.matchupAuthors[this.currentMatchupIndex]).map((p) => p.id)
    );
    this.ctx.setPhase("voting", VOTE_SECONDS, () => this.advanceMatchup());
  }

  handleVote(playerId: string, matchupId: string, answerId: string): boolean {
    if (!this.votingActive) return false;
    const matchup = this.matchups[this.currentMatchupIndex];
    if (!matchup || matchup.id !== matchupId) return false;
    // Audience members may vote too, hence getParticipant.
    const player = this.ctx.getParticipant(playerId);
    if (!player) return false;
    const authors = this.matchupAuthors[this.currentMatchupIndex];
    if (authors.includes(playerId)) return false; // can't vote your own
    if (matchup.votes[playerId]) return false; // already voted
    const answer = matchup.answers.find((a) => a.answerId === answerId);
    if (!answer) return false;
    if (answer.playerId === playerId) return false;

    matchup.votes[playerId] = answerId;
    player.hasVoted = true;
    this.ctx.emit();

    this.advanceWhenVotingComplete(authors);
    return true;
  }

  private eligibleVoters(authors: string[]) {
    return [...this.ctx.players(), ...this.ctx.audience()].filter(
      (p) => p.connected && !authors.includes(p.id)
    );
  }

  private advanceWhenVotingComplete(authors: string[]): void {
    // Only the voters present when this matchup opened gate the early advance;
    // a late arrival who has not voted must not extend the timer for everyone.
    const eligible = this.eligibleVoters(authors).filter((p) =>
      this.eligibleVoterIds.has(p.id)
    );
    if (eligible.length === 0 || !eligible.every((p) => p.hasVoted)) return;
    const remainingMs =
      MIN_VOTE_DISPLAY_SECONDS * 1000 - (this.ctx.now() - this.votingStartedAt);
    if (remainingMs <= 0) {
      this.advanceMatchup();
    } else if (!this.voteMinHandle) {
      this.voteMinHandle = setTimeout(() => {
        this.voteMinHandle = null;
        if (!this.votingActive) return;
        const currentAuthors = this.matchupAuthors[this.currentMatchupIndex] ?? [];
        this.advanceWhenVotingComplete(currentAuthors);
      }, remainingMs);
      this.voteMinHandle.unref();
    }
  }

  private clearVoteMinTimer(): void {
    if (this.voteMinHandle) clearTimeout(this.voteMinHandle);
    this.voteMinHandle = null;
  }

  /**
   * A participant was kicked. Strip their answers and votes from every matchup
   * and drop them as an author, so nothing they left behind is shown, voted on,
   * or counted. Then re-check completion (and skip the active matchup if it is
   * no longer votable).
   */
  handlePlayerRemoved(playerId: string): void {
    for (const [mi, matchup] of this.matchups.entries()) {
      matchup.answers = matchup.answers.filter((a) => a.playerId !== playerId);
      delete matchup.votes[playerId];
      this.matchupAuthors[mi] = this.matchupAuthors[mi].filter(
        (id) => id !== playerId
      );
    }
    // If we're mid-vote on a matchup that just lost an answer, it can no longer
    // be voted on — move to the next votable one.
    if (this.votingActive) {
      const active = this.matchups[this.currentMatchupIndex];
      if (!active || active.answers.length < 2) {
        this.currentMatchupIndex -= 1; // advanceMatchup pre-increments
        this.advanceMatchup();
        return;
      }
    }
    this.handlePlayerDisconnect();
  }

  /** Re-check phase completion when a player drops (see GameEngine). */
  handlePlayerDisconnect(): void {
    // Never fast-forward an abandoned room; the idle sweep will reclaim it.
    if (!this.ctx.players().some((p) => p.connected)) return;

    if (this.answeringActive) {
      if (this.ctx.players().every((p) => !p.connected || p.hasSubmitted))
        this.beginVoting();
    } else if (this.votingActive) {
      const authors = this.matchupAuthors[this.currentMatchupIndex] ?? [];
      this.advanceWhenVotingComplete(authors);
    }
  }

  /**
   * Score the round.
   *
   * Every answer a player actually wrote earns a flat bonus, including in
   * matchups that were skipped for lack of voters — writing something must
   * always beat letting the clock run out, and nothing in a party game feels
   * worse than filling in three prompts for zero points.
   *
   * Vote share then splits a pool that scales with how many of the answers
   * were real. One human against a canned safety quip halves the pool, so
   * being paired with someone who timed out stops being the highest-scoring
   * event in the game, and votes cast for the quip count in the denominator
   * so share means "share of the room".
   */
  private beginResults(): void {
    const bonus = SUBMIT_BONUS * this.round;
    const bonusFor = new Map<string, number>();
    for (const matchup of this.matchups) {
      for (const answer of matchup.answers) {
        if (answer.isSafety) continue;
        bonusFor.set(answer.playerId, (bonusFor.get(answer.playerId) ?? 0) + bonus);
      }
    }

    const results: MatchupResult[] = [];
    for (const matchup of this.matchups) {
      if (matchup.answers.length < 2) continue;
      const counts: Record<string, number> = {};
      for (const a of matchup.answers) counts[a.answerId] = 0;
      let totalVotes = 0;
      for (const voted of Object.values(matchup.votes)) {
        if (counts[voted] !== undefined) {
          counts[voted] += 1;
          totalVotes += 1;
        }
      }
      const humanCount = matchup.answers.filter((a) => !a.isSafety).length;
      const pool =
        (MATCHUP_POINT_POOL * this.round * humanCount) / matchup.answers.length;

      results.push({
        prompt: matchup.prompt,
        answers: matchup.answers.map((a) => {
          const votes = counts[a.answerId] ?? 0;
          const pointsAwarded =
            a.isSafety || totalVotes === 0
              ? 0
              : Math.round((votes / totalVotes) * pool);
          this.ctx.award(a.playerId, pointsAwarded);
          return {
            playerId: a.playerId,
            playerName: a.playerName,
            text: a.text,
            isSafety: a.isSafety,
            votes,
            pointsAwarded,
            submitBonus: a.isSafety ? 0 : bonus,
          };
        }),
      });
    }
    for (const [playerId, points] of bonusFor) this.ctx.award(playerId, points);

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
              answers: active.answers.map(({ answerId, text }) => ({ answerId, text })),
            }
          : null,
        lastResults: this.lastResults,
      },
    };
  }

  dispose(): void {
    this.answeringActive = false;
    this.votingActive = false;
    this.clearVoteMinTimer();
  }
}
