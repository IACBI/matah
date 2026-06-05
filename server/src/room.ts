import type {
  GamePhase,
  GameType,
  Language,
  Player,
  PlayerAssignment,
  RoomState,
} from "../../shared/src/index.js";
import {
  MAX_NAME_LEN,
  MAX_PLAYERS,
  MIN_PLAYERS,
} from "../../shared/src/index.js";
import type { EngineContext, GameEngine } from "./engine.js";
import { QuiplashEngine } from "./engines/quiplash.js";
import { TriviaEngine } from "./engines/trivia.js";

type Broadcast = (state: RoomState) => void;
type AssignmentSender = (playerId: string, assignment: PlayerAssignment) => void;

/**
 * A single game room. Owns authoritative membership, the phase timeline and
 * scores; delegates the actual game flow to a swappable engine.
 */
export class Room {
  readonly code: string;
  private players = new Map<string, Player>();
  private phase: GamePhase = "lobby";
  private language: Language;
  private gameType: GameType | null = null;
  private engine: GameEngine | null = null;

  private timer: number | null = null;
  private timerHandle: NodeJS.Timeout | null = null;
  private onTimeout: (() => void) | null = null;

  constructor(
    code: string,
    language: Language,
    private broadcast: Broadcast,
    private sendAssignmentFn: AssignmentSender
  ) {
    this.code = code;
    this.language = language;
  }

  // ---- membership ----

  addHost(playerId: string): void {
    this.players.set(playerId, this.newPlayer(playerId, "TV", true));
  }

  addPlayer(playerId: string, name: string): Player {
    const clean = name.trim().slice(0, MAX_NAME_LEN) || "Oyuncu";
    const player = this.newPlayer(playerId, clean, false);
    this.players.set(playerId, player);
    return player;
  }

  private newPlayer(id: string, name: string, isHost: boolean): Player {
    return {
      id,
      name,
      score: 0,
      connected: true,
      isHost,
      hasSubmitted: false,
      hasVoted: false,
      streak: 0,
    };
  }

  get realPlayers(): Player[] {
    return [...this.players.values()].filter((p) => !p.isHost);
  }

  hasPlayer(id: string): boolean {
    return this.players.has(id);
  }

  isFull(): boolean {
    return this.realPlayers.length >= MAX_PLAYERS;
  }

  isEmpty(): boolean {
    return [...this.players.values()].every((p) => !p.connected);
  }

  inLobby(): boolean {
    return this.phase === "lobby";
  }

  setConnected(playerId: string, connected: boolean): void {
    const p = this.players.get(playerId);
    if (p) p.connected = connected;
  }

  // ---- game control ----

  start(gameType: GameType): { ok: boolean; error?: string } {
    if (this.phase !== "lobby") return { ok: false, error: "Oyun zaten başladı" };
    if (this.realPlayers.length < MIN_PLAYERS)
      return { ok: false, error: `En az ${MIN_PLAYERS} oyuncu gerekli` };

    this.gameType = gameType;
    for (const p of this.players.values()) {
      p.score = 0;
      p.streak = 0;
    }
    this.engine =
      gameType === "trivia"
        ? new TriviaEngine(this.engineContext())
        : new QuiplashEngine(this.engineContext());
    this.engine.start();
    return { ok: true };
  }

  next(): void {
    if (this.phase === "lobby" || this.phase === "gameover") return;
    if (this.onTimeout) {
      const cb = this.onTimeout;
      this.clearTimer();
      cb();
    }
  }

  submitAnswer(playerId: string, matchupId: string, text: string): boolean {
    if (this.phase !== "answering") return false;
    return this.engine?.handleAnswer?.(playerId, matchupId, text) ?? false;
  }

  submitVote(playerId: string, matchupId: string, answerPlayerId: string): boolean {
    if (this.phase !== "voting") return false;
    return this.engine?.handleVote?.(playerId, matchupId, answerPlayerId) ?? false;
  }

  submitTriviaAnswer(playerId: string, questionId: string, optionIndex: number): boolean {
    if (this.phase !== "answering") return false;
    return (
      this.engine?.handleTriviaAnswer?.(playerId, questionId, optionIndex) ?? false
    );
  }

  // ---- engine context ----

  private engineContext(): EngineContext {
    return {
      language: this.language,
      players: () => this.realPlayers,
      getPlayer: (id) => {
        const p = this.players.get(id);
        return p && !p.isHost ? p : undefined;
      },
      setPhase: (phase, seconds, onTimeout) =>
        this.setPhase(phase, seconds, onTimeout),
      emit: () => this.emit(),
      sendAssignment: (id, a) => this.sendAssignmentFn(id, a),
      award: (id, points) => {
        const p = this.players.get(id);
        if (p) p.score += points;
      },
      resetFlags: () => {
        for (const p of this.players.values()) {
          p.hasSubmitted = false;
          p.hasVoted = false;
        }
      },
      toScoreboard: (seconds) =>
        this.setPhase("scoreboard", seconds, () => this.gameOver()),
      now: () => Date.now(),
    };
  }

  private gameOver(): void {
    this.setPhase("gameover", null, null);
  }

  // ---- phase + timer machinery ----

  private setPhase(
    phase: GamePhase,
    seconds: number | null,
    onTimeout: (() => void) | null
  ): void {
    this.clearTimer();
    this.phase = phase;
    this.timer = seconds;
    this.onTimeout = onTimeout;
    this.emit();

    if (seconds !== null && onTimeout) {
      this.timerHandle = setInterval(() => {
        if (this.timer === null) return;
        this.timer -= 1;
        if (this.timer <= 0) {
          const cb = this.onTimeout;
          this.clearTimer();
          cb?.();
        } else {
          this.emit();
        }
      }, 1000);
    }
  }

  private clearTimer(): void {
    if (this.timerHandle) clearInterval(this.timerHandle);
    this.timerHandle = null;
    this.timer = null;
    this.onTimeout = null;
  }

  // ---- serialization ----

  private buildState(): RoomState {
    const view = this.engine?.serialize();
    return {
      code: this.code,
      phase: this.phase,
      gameType: this.gameType,
      language: this.language,
      round: view?.round ?? 0,
      totalRounds: view?.totalRounds ?? 0,
      players: this.realPlayers.map((p) => ({ ...p })),
      timer: this.timer,
      quiplash: view?.quiplash,
      trivia: view?.trivia,
    };
  }

  emit(): void {
    this.broadcast(this.buildState());
  }

  dispose(): void {
    this.clearTimer();
    this.engine?.dispose();
  }
}
