import { randomUUID } from "node:crypto";
import type {
  GamePhase,
  GameType,
  Language,
  Player,
  PlayerAssignment,
  RoomState,
} from "../../shared/src/index.js";
import {
  clampLength,
  DEFAULT_AVATAR,
  DEFAULT_TOTAL_ROUNDS,
  MAX_AUDIENCE,
  MAX_NAME_LEN,
  MAX_PLAYERS,
  MAX_QUESTIONS,
  MAX_ROUNDS,
  MIN_PLAYERS,
  MIN_QUESTIONS,
  MIN_ROUNDS,
  TRIVIA_QUESTIONS,
} from "../../shared/src/index.js";
import type { EngineContext, GameEngine } from "./engine.js";
import { QuiplashEngine } from "./engines/quiplash.js";
import { TriviaEngine } from "./engines/trivia.js";

type Broadcast = (state: RoomState) => void;

/** Localized default for players who somehow join with an empty name. */
const FALLBACK_NAMES: Record<Language, string> = {
  tr: "Oyuncu",
  en: "Player",
  de: "Spieler",
  es: "Jugador",
  fr: "Joueur",
  it: "Giocatore",
  pt: "Jogador",
  ru: "Игрок",
  ar: "لاعب",
  zh: "玩家",
  ja: "プレイヤー",
  ko: "플레이어",
  hi: "खिलाड़ी",
  nl: "Speler",
};
/** Sends an assignment to a specific live socket. */
type AssignmentSender = (socketId: string, assignment: PlayerAssignment) => void;

/**
 * A single game room. Owns authoritative membership, the phase timeline and
 * scores; delegates the actual game flow to a swappable engine.
 *
 * Player identity (`pid`) is stable for the whole game and decoupled from the
 * socket id, so a player can drop and reconnect (new socket) without losing
 * their seat, score, or in-flight prompts.
 */
export class Room {
  readonly code: string;
  private players = new Map<string, Player>(); // pid -> player
  private sockets = new Map<string, string>(); // pid -> current socket id
  private phase: GamePhase = "lobby";
  private language: Language;
  private gameType: GameType | null = null;
  private engine: GameEngine | null = null;

  private timer: number | null = null;
  private timerHandle: NodeJS.Timeout | null = null;
  private onTimeout: (() => void) | null = null;
  private lastActivity = Date.now();

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

  /** Adds the host (TV) screen. Returns its stable pid. */
  addHost(socketId: string): string {
    const pid = randomUUID();
    this.players.set(pid, this.newPlayer(pid, "TV", "📺", { isHost: true }));
    this.sockets.set(pid, socketId);
    return pid;
  }

  /** Adds a player (or an audience member). Returns their stable pid. */
  addPlayer(
    socketId: string,
    name: string,
    avatar: string = DEFAULT_AVATAR,
    isAudience = false
  ): string {
    const pid = randomUUID();
    const clean =
      name.trim().slice(0, MAX_NAME_LEN) || FALLBACK_NAMES[this.language];
    this.players.set(pid, this.newPlayer(pid, clean, avatar, { isAudience }));
    this.sockets.set(pid, socketId);
    return pid;
  }

  /** Reattaches an existing pid to a new socket after a reconnect. */
  rejoin(pid: string, socketId: string): boolean {
    const player = this.players.get(pid);
    if (!player) return false;
    this.sockets.set(pid, socketId);
    player.connected = true;
    return true;
  }

  /** Re-sends the current per-player assignment (e.g. after reconnect). */
  resendAssignment(pid: string): void {
    const a = this.engine?.currentAssignment?.(pid);
    if (a) this.sendAssignmentToPid(pid, a);
  }

  private sendAssignmentToPid(pid: string, a: PlayerAssignment): void {
    const socketId = this.sockets.get(pid);
    if (socketId) this.sendAssignmentFn(socketId, a);
  }

  private newPlayer(
    id: string,
    name: string,
    avatar: string,
    flags: { isHost?: boolean; isAudience?: boolean } = {}
  ): Player {
    return {
      id,
      name,
      avatar,
      score: 0,
      connected: true,
      isHost: flags.isHost ?? false,
      isAudience: flags.isAudience ?? false,
      hasSubmitted: false,
      hasVoted: false,
      streak: 0,
    };
  }

  /** Active players: in the game, excluding the host screen and audience. */
  get realPlayers(): Player[] {
    return [...this.players.values()].filter((p) => !p.isHost && !p.isAudience);
  }

  get audiencePlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.isAudience);
  }

  isFull(): boolean {
    return this.realPlayers.length >= MAX_PLAYERS;
  }

  isAudienceFull(): boolean {
    return this.audiencePlayers.length >= MAX_AUDIENCE;
  }

  isAudience(pid: string): boolean {
    return this.players.get(pid)?.isAudience === true;
  }

  /** True while the host (TV) screen has a live socket. */
  hostConnected(): boolean {
    return [...this.players.values()].some((p) => p.isHost && p.connected);
  }

  /**
   * Host controls (start/next/restart) normally require the host, but if the
   * host screen dropped, any active player may take over so the room never
   * gets stuck.
   */
  canControl(pid: string): boolean {
    if (this.isHost(pid)) return true;
    const p = this.players.get(pid);
    return !!p && !p.isAudience && !this.hostConnected();
  }

  isEmpty(): boolean {
    return [...this.players.values()].every((p) => !p.connected);
  }

  inLobby(): boolean {
    return this.phase === "lobby";
  }

  /** Marks the player currently mapped to this socket offline (reconnect-safe). */
  handleDisconnect(socketId: string): void {
    for (const [pid, sid] of this.sockets) {
      if (sid === socketId) {
        const p = this.players.get(pid);
        if (p) p.connected = false;
        // Let the engine re-check its "everyone done?" conditions so the
        // dropped player doesn't stall the current phase until the timer.
        if (p && !p.isHost) this.engine?.handlePlayerDisconnect?.(pid);
        return;
      }
    }
  }

  /** The pid currently bound to this socket id, if any. */
  pidForSocket(socketId: string): string | null {
    for (const [pid, sid] of this.sockets) if (sid === socketId) return pid;
    return null;
  }

  // ---- game control ----

  start(gameType: GameType, rounds?: number): { ok: boolean; error?: string } {
    if (this.phase !== "lobby") return { ok: false, error: "already_started" };
    if (this.realPlayers.length < MIN_PLAYERS)
      return { ok: false, error: "not_enough_players" };

    this.gameType = gameType;
    for (const p of this.players.values()) {
      p.score = 0;
      p.streak = 0;
    }
    if (gameType === "trivia") {
      const count = clampLength(rounds, MIN_QUESTIONS, MAX_QUESTIONS, TRIVIA_QUESTIONS);
      this.engine = new TriviaEngine(this.engineContext(), count);
    } else {
      const count = clampLength(rounds, MIN_ROUNDS, MAX_ROUNDS, DEFAULT_TOTAL_ROUNDS);
      this.engine = new QuiplashEngine(this.engineContext(), count);
    }
    this.engine.start();
    return { ok: true };
  }

  /**
   * Host removed a participant. Drops them from membership, disconnecting any
   * live socket from the room, then lets the active engine re-check its
   * "everyone done?" condition so the kicked player can't stall the round.
   * Returns the removed player's current socket id (to notify them), if any.
   */
  kick(targetPid: string): { ok: boolean; socketId?: string; error?: string } {
    const target = this.players.get(targetPid);
    if (!target || target.isHost) return { ok: false, error: "invalid_target" };
    const socketId = this.sockets.get(targetPid);
    const wasActive = !target.isAudience;
    this.players.delete(targetPid);
    this.sockets.delete(targetPid);
    if (wasActive) this.engine?.handlePlayerDisconnect?.(targetPid);
    this.emit();
    return { ok: true, socketId };
  }

  /** Host ended the game early — jump straight to the final scoreboard. */
  endGame(): void {
    if (this.phase === "lobby" || this.phase === "gameover") return;
    this.setPhase("scoreboard", 15, () => this.gameOver());
  }

  next(): void {
    if (this.phase === "lobby" || this.phase === "gameover") return;
    if (this.onTimeout) {
      const cb = this.onTimeout;
      this.clearTimer();
      cb();
    }
  }

  isHost(pid: string): boolean {
    return this.players.get(pid)?.isHost === true;
  }

  /** Identity payload for a reaction broadcast; null for the host screen. */
  getReactionSender(
    pid: string
  ): { playerId: string; name: string; avatar: string } | null {
    const p = this.players.get(pid);
    if (!p || p.isHost) return null;
    return { playerId: p.id, name: p.name, avatar: p.avatar };
  }

  /** Returns a finished game to the lobby, keeping the same players. */
  returnToLobby(): void {
    this.clearTimer();
    this.engine?.dispose();
    this.engine = null;
    this.gameType = null;
    this.phase = "lobby";
    // Audience members waited a whole game — promote them to real players
    // (join order) while there is room.
    for (const p of this.players.values()) {
      if (p.isAudience && this.realPlayers.length < MAX_PLAYERS) {
        p.isAudience = false;
      }
    }
    for (const p of this.players.values()) {
      p.score = 0;
      p.streak = 0;
      p.hasSubmitted = false;
      p.hasVoted = false;
    }
    this.emit();
  }

  submitAnswer(pid: string, matchupId: string, text: string): boolean {
    if (this.phase !== "answering") return false;
    return this.engine?.handleAnswer?.(pid, matchupId, text) ?? false;
  }

  submitVote(pid: string, matchupId: string, answerPlayerId: string): boolean {
    if (this.phase !== "voting") return false;
    return this.engine?.handleVote?.(pid, matchupId, answerPlayerId) ?? false;
  }

  submitTriviaAnswer(pid: string, questionId: string, optionIndex: number): boolean {
    if (this.phase !== "answering") return false;
    return this.engine?.handleTriviaAnswer?.(pid, questionId, optionIndex) ?? false;
  }

  // ---- engine context ----

  private engineContext(): EngineContext {
    return {
      language: this.language,
      players: () => this.realPlayers,
      audience: () => this.audiencePlayers,
      getPlayer: (id) => {
        const p = this.players.get(id);
        return p && !p.isHost && !p.isAudience ? p : undefined;
      },
      getParticipant: (id) => {
        const p = this.players.get(id);
        return p && !p.isHost ? p : undefined;
      },
      setPhase: (phase, seconds, onTimeout) =>
        this.setPhase(phase, seconds, onTimeout),
      emit: () => this.emit(),
      sendAssignment: (pid, a) => this.sendAssignmentToPid(pid, a),
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
      audience: this.audiencePlayers.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        connected: p.connected,
      })),
      hostConnected: this.hostConnected(),
      timer: this.timer,
      quiplash: view?.quiplash,
      trivia: view?.trivia,
    };
  }

  emit(): void {
    this.lastActivity = Date.now();
    this.broadcast(this.buildState());
  }

  /** True if the room has had no activity for longer than maxIdleMs. */
  isStale(maxIdleMs: number): boolean {
    return Date.now() - this.lastActivity > maxIdleMs;
  }

  dispose(): void {
    this.clearTimer();
    this.engine?.dispose();
  }
}
