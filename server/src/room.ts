import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { performance } from "node:perf_hooks";
import type {
  ApiErrorCode,
  GamePhase,
  GameType,
  Language,
  Player,
  PlayerAssignment,
  RoomState,
  SessionResult,
} from "../../shared/src/index.js";
import {
  clampLength,
  DEFAULT_AVATAR,
  DEFAULT_TOTAL_ROUNDS,
  HOST_AVATAR,
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
import { sanitizeUserText } from "./util.js";

type Broadcast = (state: RoomState) => void;
type AssignmentSender = (socketId: string, assignment: PlayerAssignment) => void;

export const DEFAULT_MEMBER_EXPIRY_MS = 120_000;
export const DEFAULT_CONTROLLER_FAILOVER_MS = 10_000;

export interface RoomLifecycleOptions {
  memberExpiryMs?: number;
  controllerFailoverMs?: number;
  wallNow?: () => number;
  monotonicNow?: () => number;
}

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

interface RejoinResult extends SessionResult {
  replacedSocketId?: string;
}

interface LastGameConfig {
  gameType: GameType;
  rounds: number;
}

/** Authoritative in-memory state and lifecycle for one room. */
export class Room {
  readonly code: string;
  private players = new Map<string, Player>();
  private sockets = new Map<string, string>(); // playerId -> current socket
  private sessionHashes = new Map<string, Buffer>();
  private memberExpiry = new Map<string, NodeJS.Timeout>();

  private phase: GamePhase = "lobby";
  private phaseId = 0;
  private phaseEndsAt: number | null = null;
  private language: Language;
  private gameType: GameType | null = null;
  private lastGameConfig: LastGameConfig | null = null;
  private engine: GameEngine | null = null;
  private recentContent: Record<GameType, Set<string>> = {
    quiplash: new Set(),
    trivia: new Set(),
  };

  private timerHandle: NodeJS.Timeout | null = null;
  private onTimeout: (() => void) | null = null;
  private controllerPlayerId: string | null = null;
  private controllerTimer: NodeJS.Timeout | null = null;
  private hostDisconnectedAt: number | null = null;
  private lastActivity: number;
  private readonly memberExpiryMs: number;
  private readonly controllerFailoverMs: number;
  private readonly wallNow: () => number;
  private readonly monotonicNow: () => number;

  constructor(
    code: string,
    language: Language,
    private broadcast: Broadcast,
    private sendAssignmentFn: AssignmentSender,
    options: RoomLifecycleOptions = {}
  ) {
    this.code = code;
    this.language = language;
    this.memberExpiryMs = options.memberExpiryMs ?? DEFAULT_MEMBER_EXPIRY_MS;
    this.controllerFailoverMs =
      options.controllerFailoverMs ?? DEFAULT_CONTROLLER_FAILOVER_MS;
    this.wallNow = options.wallNow ?? Date.now;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.lastActivity = this.wallNow();
  }

  // ---- membership and private resume credentials ----

  addHost(socketId: string): SessionResult {
    const result = this.addMember(socketId, "TV", HOST_AVATAR, {
      isHost: true,
    });
    this.onHostConnected();
    return result;
  }

  addPlayer(
    socketId: string,
    name: string,
    avatar: string = DEFAULT_AVATAR,
    isAudience = false
  ): SessionResult {
    const clean =
      sanitizeUserText(name, MAX_NAME_LEN) || FALLBACK_NAMES[this.language];
    return this.addMember(socketId, clean, avatar, { isAudience });
  }

  private addMember(
    socketId: string,
    name: string,
    avatar: string,
    flags: { isHost?: boolean; isAudience?: boolean }
  ): SessionResult {
    const playerId = randomUUID();
    const resumeToken = this.rotateResumeToken(playerId);
    const player = this.newPlayer(playerId, name, avatar, flags);
    this.players.set(playerId, player);
    this.sockets.set(playerId, socketId);
    this.touch();
    return {
      code: this.code,
      playerId,
      resumeToken,
      isAudience: player.isAudience,
    };
  }

  /** Reattaches by a private token and rotates it to prevent replay. */
  rejoin(resumeToken: string, socketId: string): RejoinResult | null {
    const playerId = this.playerIdForToken(resumeToken);
    if (!playerId) return null;
    const player = this.players.get(playerId);
    if (!player) return null;

    const existingPlayerId = this.pidForSocket(socketId);
    if (existingPlayerId && existingPlayerId !== playerId) {
      this.removeMember(existingPlayerId);
    }

    const replacedSocketId = this.sockets.get(playerId);
    this.sockets.set(playerId, socketId);
    player.connected = true;
    this.clearMemberExpiry(playerId);
    if (player.isHost) this.onHostConnected();
    this.touch();

    return {
      code: this.code,
      playerId,
      resumeToken: this.rotateResumeToken(playerId),
      isAudience: player.isAudience,
      replacedSocketId:
        replacedSocketId && replacedSocketId !== socketId
          ? replacedSocketId
          : undefined,
    };
  }

  /** Socket.IO CSR retains the opaque socket session, so no token is exposed. */
  recoverSocket(socketId: string): string | null {
    const playerId = this.pidForSocket(socketId);
    if (!playerId) return null;
    const player = this.players.get(playerId);
    if (!player) return null;
    player.connected = true;
    this.clearMemberExpiry(playerId);
    if (player.isHost) this.onHostConnected();
    this.touch();
    return playerId;
  }

  private rotateResumeToken(playerId: string): string {
    const token = randomBytes(32).toString("base64url");
    this.sessionHashes.set(playerId, this.hashToken(token));
    return token;
  }

  private playerIdForToken(token: string): string | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const candidate = this.hashToken(token);
    for (const [playerId, expected] of this.sessionHashes) {
      if (timingSafeEqual(candidate, expected)) return playerId;
    }
    return null;
  }

  private hashToken(token: string): Buffer {
    return createHash("sha256").update(token, "utf8").digest();
  }

  resendAssignment(playerId: string): void {
    const assignment = this.engine?.currentAssignment?.(playerId);
    if (assignment) this.sendAssignmentToPid(playerId, assignment);
  }

  private sendAssignmentToPid(playerId: string, assignment: PlayerAssignment): void {
    const socketId = this.sockets.get(playerId);
    if (socketId && this.players.get(playerId)?.connected) {
      this.sendAssignmentFn(socketId, assignment);
    }
  }

  private newPlayer(
    id: string,
    name: string,
    avatar: string,
    flags: { isHost?: boolean; isAudience?: boolean }
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

  get realPlayers(): Player[] {
    return [...this.players.values()].filter((p) => !p.isHost && !p.isAudience);
  }

  get audiencePlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.isAudience);
  }

  private get connectedRealPlayers(): Player[] {
    return this.realPlayers.filter((p) => p.connected);
  }

  isFull(): boolean {
    return this.realPlayers.length >= MAX_PLAYERS;
  }

  isAudienceFull(): boolean {
    return this.audiencePlayers.length >= MAX_AUDIENCE;
  }

  isAudience(playerId: string): boolean {
    return this.players.get(playerId)?.isAudience === true;
  }

  hostConnected(): boolean {
    return [...this.players.values()].some((p) => p.isHost && p.connected);
  }

  canControl(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (!player?.connected) return false;
    if (player.isHost) return this.hostConnected();
    return !player.isAudience && playerId === this.controllerPlayerId;
  }

  controlError(playerId: string, expectedPhaseId: unknown): ApiErrorCode | null {
    if (!Number.isInteger(expectedPhaseId) || expectedPhaseId !== this.phaseId) {
      return "stale_phase";
    }
    return this.canControl(playerId) ? null : "host_only";
  }

  get currentPhaseId(): number {
    return this.phaseId;
  }

  isEmpty(): boolean {
    return [...this.players.values()].every((p) => !p.connected);
  }

  isVacant(): boolean {
    return this.players.size === 0;
  }

  inLobby(): boolean {
    return this.phase === "lobby";
  }

  handleDisconnect(socketId: string): void {
    const playerId = this.pidForSocket(socketId);
    if (!playerId) return;
    const player = this.players.get(playerId);
    if (!player || !player.connected) return;

    player.connected = false;
    this.scheduleMemberExpiry(playerId);
    this.touch();
    if (player.isHost) {
      this.beginControllerFailover();
    } else {
      this.engine?.handlePlayerDisconnect?.(playerId);
      if (this.controllerPlayerId === playerId) {
        this.controllerPlayerId = null;
        this.electController();
      }
    }
  }

  /** Explicit leave removes the reservation immediately. */
  leaveBySocket(socketId: string): string | null {
    const playerId = this.pidForSocket(socketId);
    if (!playerId) return null;
    this.removeMember(playerId);
    return playerId;
  }

  private scheduleMemberExpiry(playerId: string): void {
    this.clearMemberExpiry(playerId);
    const handle = setTimeout(() => {
      this.memberExpiry.delete(playerId);
      if (!this.players.get(playerId)?.connected) this.removeMember(playerId);
    }, this.memberExpiryMs);
    handle.unref();
    this.memberExpiry.set(playerId, handle);
  }

  private clearMemberExpiry(playerId: string): void {
    const handle = this.memberExpiry.get(playerId);
    if (handle) clearTimeout(handle);
    this.memberExpiry.delete(playerId);
  }

  private removeMember(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    this.clearMemberExpiry(playerId);
    this.players.delete(playerId);
    this.sockets.delete(playerId);
    this.sessionHashes.delete(playerId);
    if (!player.isHost) this.engine?.handlePlayerRemoved?.(playerId);
    if (player.isHost) {
      this.beginControllerFailover();
    } else if (this.controllerPlayerId === playerId) {
      this.controllerPlayerId = null;
      this.electController();
    }
    this.touch();
    this.emit();
  }

  pidForSocket(socketId: string): string | null {
    for (const [playerId, boundSocketId] of this.sockets) {
      if (boundSocketId === socketId) return playerId;
    }
    return null;
  }

  private onHostConnected(): void {
    this.hostDisconnectedAt = null;
    this.controllerPlayerId = null;
    if (this.controllerTimer) clearTimeout(this.controllerTimer);
    this.controllerTimer = null;
  }

  private beginControllerFailover(): void {
    if (this.hostConnected()) return;
    const now = this.wallNow();
    this.hostDisconnectedAt ??= now;
    const elapsed = now - this.hostDisconnectedAt;
    if (elapsed < this.controllerFailoverMs) this.controllerPlayerId = null;
    if (this.controllerTimer) clearTimeout(this.controllerTimer);
    const remaining = Math.max(
      0,
      this.controllerFailoverMs - elapsed
    );
    this.controllerTimer = setTimeout(() => {
      this.controllerTimer = null;
      this.electController();
    }, remaining);
    this.controllerTimer.unref();
  }

  private electController(): void {
    if (this.hostConnected()) {
      this.onHostConnected();
      return;
    }
    if (
      this.hostDisconnectedAt === null ||
      this.wallNow() - this.hostDisconnectedAt < this.controllerFailoverMs
    ) {
      this.beginControllerFailover();
      return;
    }
    const next = this.connectedRealPlayers[0]?.id ?? null;
    if (next !== this.controllerPlayerId) {
      this.controllerPlayerId = next;
      this.emit();
    }
  }

  // ---- game control ----

  setLanguage(language: Language): ApiErrorCode | null {
    if (this.phase !== "lobby") return "invalid_phase";
    this.language = language;
    this.bumpRevision();
    return null;
  }

  start(gameType: GameType, rounds?: number): ApiErrorCode | null {
    if (this.phase !== "lobby") return "already_started";
    if (this.connectedRealPlayers.length < MIN_PLAYERS) {
      return "not_enough_players";
    }
    const count = gameType === "trivia"
      ? clampLength(rounds, MIN_QUESTIONS, MAX_QUESTIONS, TRIVIA_QUESTIONS)
      : clampLength(rounds, MIN_ROUNDS, MAX_ROUNDS, DEFAULT_TOTAL_ROUNDS);
    this.startGame(gameType, count, false);
    return null;
  }

  private startGame(gameType: GameType, rounds: number, isRematch: boolean): void {
    this.clearTimer();
    this.engine?.dispose();
    this.gameType = gameType;
    this.lastGameConfig = { gameType, rounds };
    for (const player of this.players.values()) {
      player.score = 0;
      player.streak = 0;
      player.hasSubmitted = false;
      player.hasVoted = false;
    }
    const previousContent = isRematch
      ? new Set(this.recentContent[gameType])
      : new Set<string>();
    const selectedContent = new Set<string>();
    this.recentContent[gameType] = selectedContent;
    const recordContent = (key: string): void => {
      selectedContent.add(key);
    };
    this.engine = gameType === "trivia"
      ? new TriviaEngine(this.engineContext(), rounds, previousContent, recordContent)
      : new QuiplashEngine(this.engineContext(), rounds, previousContent, recordContent);
    this.touch();
    this.engine.start();
  }

  rematch(): ApiErrorCode | null {
    if (this.phase !== "scoreboard" && this.phase !== "gameover") {
      return "invalid_phase";
    }
    if (!this.lastGameConfig) return "invalid_game";
    if (this.connectedRealPlayers.length < MIN_PLAYERS) {
      return "not_enough_players";
    }
    this.startGame(this.lastGameConfig.gameType, this.lastGameConfig.rounds, true);
    return null;
  }

  kick(targetPlayerId: string): {
    ok: boolean;
    socketId?: string;
    error?: ApiErrorCode;
  } {
    const target = this.players.get(targetPlayerId);
    if (!target || target.isHost) return { ok: false, error: "invalid_target" };
    const socketId = this.sockets.get(targetPlayerId);
    this.removeMember(targetPlayerId);
    this.bumpRevision();
    return { ok: true, socketId };
  }

  endGame(): ApiErrorCode | null {
    if (
      this.phase === "lobby" ||
      this.phase === "scoreboard" ||
      this.phase === "gameover"
    ) {
      return "invalid_phase";
    }
    this.engine?.dispose();
    this.setPhase("scoreboard", 15, () => this.gameOver());
    return null;
  }

  next(): ApiErrorCode | null {
    if (this.phase === "lobby" || this.phase === "gameover" || !this.onTimeout) {
      return "invalid_phase";
    }
    const callback = this.onTimeout;
    this.clearTimer();
    callback();
    this.touch();
    return null;
  }

  returnToLobby(): ApiErrorCode | null {
    if (this.phase === "lobby") return "invalid_phase";
    this.clearTimer();
    this.engine?.dispose();
    this.engine = null;
    this.gameType = null;
    for (const player of this.players.values()) {
      if (
        player.connected &&
        player.isAudience &&
        this.realPlayers.length < MAX_PLAYERS
      ) {
        player.isAudience = false;
      }
    }
    for (const player of this.players.values()) {
      player.score = 0;
      player.streak = 0;
      player.hasSubmitted = false;
      player.hasVoted = false;
    }
    this.touch();
    this.setPhase("lobby", null, null);
    return null;
  }

  isHost(playerId: string): boolean {
    return this.players.get(playerId)?.isHost === true;
  }

  getReactionSender(
    playerId: string
  ): { playerId: string; name: string; avatar: string } | null {
    if (this.phase === "lobby" || this.phase === "gameover") return null;
    const player = this.players.get(playerId);
    if (!player || player.isHost || !player.connected) return null;
    this.touch();
    return { playerId: player.id, name: player.name, avatar: player.avatar };
  }

  submitAnswer(playerId: string, matchupId: string, text: string): boolean {
    if (this.phase !== "answering") return false;
    const accepted = this.engine?.handleAnswer?.(playerId, matchupId, text) ?? false;
    if (accepted) this.touch();
    return accepted;
  }

  submitVote(playerId: string, matchupId: string, answerId: string): boolean {
    if (this.phase !== "voting") return false;
    const accepted = this.engine?.handleVote?.(playerId, matchupId, answerId) ?? false;
    if (accepted) this.touch();
    return accepted;
  }

  submitTriviaAnswer(
    playerId: string,
    questionId: string,
    optionIndex: number
  ): boolean {
    if (this.phase !== "answering") return false;
    const accepted =
      this.engine?.handleTriviaAnswer?.(playerId, questionId, optionIndex) ?? false;
    if (accepted) this.touch();
    return accepted;
  }

  // ---- engine context and phase deadline ----

  private engineContext(): EngineContext {
    return {
      language: this.language,
      players: () => this.realPlayers,
      audience: () => this.audiencePlayers,
      getPlayer: (id) => {
        const player = this.players.get(id);
        return player && !player.isHost && !player.isAudience ? player : undefined;
      },
      getParticipant: (id) => {
        const player = this.players.get(id);
        return player && !player.isHost ? player : undefined;
      },
      setPhase: (phase, seconds, onTimeout) =>
        this.setPhase(phase, seconds, onTimeout),
      emit: () => this.emit(),
      sendAssignment: (playerId, assignment) =>
        this.sendAssignmentToPid(playerId, assignment),
      award: (id, points) => {
        const player = this.players.get(id);
        if (player) player.score += points;
      },
      resetFlags: () => {
        for (const player of this.players.values()) {
          player.hasSubmitted = false;
          player.hasVoted = false;
        }
      },
      toScoreboard: (seconds) =>
        this.setPhase("scoreboard", seconds, () => this.gameOver()),
      now: this.monotonicNow,
    };
  }

  private gameOver(): void {
    this.setPhase("gameover", null, null);
  }

  private setPhase(
    phase: GamePhase,
    seconds: number | null,
    onTimeout: (() => void) | null
  ): void {
    this.clearTimer();
    this.phase = phase;
    this.phaseId += 1;
    this.phaseEndsAt = seconds === null ? null : this.wallNow() + seconds * 1000;
    this.onTimeout = onTimeout;
    this.emit();

    if (seconds !== null && onTimeout) {
      this.timerHandle = setTimeout(() => {
        const callback = this.onTimeout;
        this.clearTimer();
        callback?.();
      }, seconds * 1000);
      this.timerHandle.unref();
    }
  }

  private bumpRevision(): void {
    this.phaseId += 1;
    this.touch();
    this.emit();
  }

  private clearTimer(): void {
    if (this.timerHandle) clearTimeout(this.timerHandle);
    this.timerHandle = null;
    this.phaseEndsAt = null;
    this.onTimeout = null;
  }

  private buildState(): RoomState {
    const view = this.engine?.serialize();
    const serverNow = this.wallNow();
    return {
      code: this.code,
      phase: this.phase,
      gameType: this.gameType,
      language: this.language,
      round: view?.round ?? 0,
      totalRounds: view?.totalRounds ?? 0,
      players: this.realPlayers.map((player) => ({ ...player })),
      audience: this.audiencePlayers.map((player) => ({
        id: player.id,
        name: player.name,
        avatar: player.avatar,
        connected: player.connected,
      })),
      hostConnected: this.hostConnected(),
      phaseId: this.phaseId,
      phaseEndsAt: this.phaseEndsAt,
      serverNow,
      controllerPlayerId: this.controllerPlayerId,
      quiplash: view?.quiplash,
      trivia: view?.trivia,
    };
  }

  emit(): void {
    this.broadcast(this.buildState());
  }

  private touch(): void {
    this.lastActivity = this.wallNow();
  }

  isStale(maxIdleMs: number): boolean {
    return this.isEmpty() && this.wallNow() - this.lastActivity > maxIdleMs;
  }

  dispose(): void {
    this.clearTimer();
    this.engine?.dispose();
    for (const handle of this.memberExpiry.values()) clearTimeout(handle);
    this.memberExpiry.clear();
    if (this.controllerTimer) clearTimeout(this.controllerTimer);
    this.controllerTimer = null;
  }
}
