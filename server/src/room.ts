import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { performance } from "node:perf_hooks";
import type {
  ApiErrorCode,
  Capability,
  GamePhase,
  GameType,
  Highlight,
  Language,
  Player,
  PlayerAssignment,
  RoomState,
  SessionResult,
} from "../../shared/src/index.js";
import {
  BLUFF_QUESTIONS,
  clampLength,
  DEFAULT_AVATAR,
  DEFAULT_TOTAL_ROUNDS,
  GAME_TYPES,
  MAX_AUDIENCE,
  MAX_BLUFF_QUESTIONS,
  MAX_CUSTOM_PROMPTS,
  MAX_NAME_LEN,
  MAX_PLAYERS,
  MAX_PROMPT_LEN,
  MAX_QUESTIONS,
  MAX_ROUNDS,
  MIN_BLUFF_QUESTIONS,
  MIN_PLAYERS,
  MIN_QUESTIONS,
  MIN_ROUNDS,
  TRIVIA_QUESTIONS,
} from "../../shared/src/index.js";
import type { EngineContext, EngineSnapshot, GameEngine } from "./engine.js";
import { BluffEngine } from "./engines/bluff.js";
import { QuiplashEngine } from "./engines/quiplash.js";
import { TriviaEngine } from "./engines/trivia.js";
import { sanitizeUserText } from "./util.js";

type Broadcast = (state: RoomState) => void;
type AssignmentSender = (socketId: string, assignment: PlayerAssignment) => void;

export const DEFAULT_MEMBER_EXPIRY_MS = 120_000;
export const DEFAULT_CONTROLLER_FAILOVER_MS = 10_000;
/**
 * Extra time a restored game gives its phase: every phone has to notice the
 * restart and reconnect before anyone can act again.
 */
export const DEFAULT_RESTORE_GRACE_MS = 15_000;
/** Bumped whenever `RoomSnapshot` changes shape; older snapshots are ignored. */
export const ROOM_SNAPSHOT_VERSION = 1;

export interface RoomLifecycleOptions {
  memberExpiryMs?: number;
  controllerFailoverMs?: number;
  restoreGraceMs?: number;
  wallNow?: () => number;
  monotonicNow?: () => number;
}

/**
 * Plain JSON a room can be rebuilt from after a restart. Resume credentials
 * are stored only as the SHA-256 hashes the room already keeps, so a leaked
 * snapshot does not hand anyone a way into a session.
 */
export interface RoomSnapshot {
  version: number;
  code: string;
  language: Language;
  players: Player[];
  sessionSecrets: [string, string][];
  phase: GamePhase;
  phaseId: number;
  /** Time left on the phase clock, running or paused; null without a timer. */
  remainingMs: number | null;
  paused: boolean;
  gameType: GameType | null;
  lastGameConfig: LastGameConfig | null;
  recentContent: Record<GameType, string[]>;
  customPrompts: string[];
  benched: string[];
  gamesPlayed: number;
  gameSettled: boolean;
  highlights: Highlight[] | null;
  finalView: { round: number; totalRounds: number } | null;
  engine: EngineSnapshot | null;
}

/** Capabilities the elected stand-in controller does *not* inherit. */
const HOST_ONLY_CAPABILITIES = new Set<Capability>(["kick", "seat", "content"]);
const TIMED_PHASES = new Set<GamePhase>(["answering", "voting", "results", "scoreboard"]);

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
  private socketToPlayer = new Map<string, string>(); // the reverse index
  private sessionSecrets = new Map<string, Buffer>();
  private memberExpiry = new Map<string, NodeJS.Timeout>();

  private phase: GamePhase = "lobby";
  private phaseId = 0;
  private phaseEndsAt: number | null = null;
  /** Snapshot kept so the scoreboard survives `endGame` dropping the engine. */
  private finalView: { round: number; totalRounds: number } | null = null;

  // Broadcasts are coalesced onto a microtask: one user action can mutate the
  // room several times (kick -> engine purge -> phase change), and clients
  // should see one consistent state, with at most one phaseId increment.
  private broadcastPending = false;
  private phaseBumpPending = false;
  private language: Language;
  private gameType: GameType | null = null;
  private lastGameConfig: LastGameConfig | null = null;
  private engine: GameEngine | null = null;
  private recentContent: Record<GameType, Set<string>> = {
    quiplash: new Set(),
    trivia: new Set(),
    bluff: new Set(),
  };
  /** Host-written Quiplash prompts, already sanitized. */
  private customPrompts: string[] = [];
  /** Players the host sent to the audience; seat promotion skips them. */
  private benched = new Set<string>();
  private gamesPlayed = 0;
  /** Whether the current game's scores are banked into the session yet. */
  private gameSettled = true;
  private highlights: Highlight[] | null = null;

  private timerHandle: NodeJS.Timeout | null = null;
  private onTimeout: (() => void) | null = null;
  /** Monotonic deadline of the running phase timer. */
  private deadlineMono: number | null = null;
  /** Frozen time left while paused; null while the clock runs. */
  private pausedRemainingMs: number | null = null;
  private pausedAtMono = 0;
  /** Paused time so far, subtracted from the game clock engines read. */
  private pausedTotalMs = 0;
  private controllerPlayerId: string | null = null;
  private controllerTimer: NodeJS.Timeout | null = null;
  private hostDisconnectedAt: number | null = null;
  private lastActivity: number;
  private readonly memberExpiryMs: number;
  private readonly controllerFailoverMs: number;
  private readonly restoreGraceMs: number;
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
    this.restoreGraceMs = options.restoreGraceMs ?? DEFAULT_RESTORE_GRACE_MS;
    this.wallNow = options.wallNow ?? Date.now;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.lastActivity = this.wallNow();
  }

  // ---- membership and private resume credentials ----

  addHost(socketId: string): SessionResult {
    // The host is never in `players` or `audience`, so its avatar is never
    // rendered — but the field is required, so use the shared default.
    const result = this.addMember(socketId, "TV", DEFAULT_AVATAR, {
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
    this.bindSocket(playerId, socketId);
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
    this.bindSocket(playerId, socketId);
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

  /**
   * Issue a fresh token, invalidating the old one immediately.
   *
   * Rotation happens before the acknowledgement carrying the new token reaches
   * the client, so a dropped ack does strand that session. Keeping the old
   * token alive for a grace period would fix that, but it would also make a
   * resume token replayable — the exact property SECURITY.md promises and
   * socket-security.test.mjs guards. A stranded session costs the player their
   * score for one game; a replayable credential costs them the session. The
   * client surfaces the failure with a retry instead (see App.tsx).
   */
  private rotateResumeToken(playerId: string): string {
    const token = randomBytes(32).toString("base64url");
    this.sessionSecrets.set(playerId, this.hashToken(token));
    return token;
  }

  private playerIdForToken(token: string): string | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const candidate = this.hashToken(token);
    for (const [playerId, expected] of this.sessionSecrets) {
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
      sessionScore: 0,
      wins: 0,
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

  hostConnected(): boolean {
    for (const player of this.players.values()) {
      if (player.isHost && player.connected) return true;
    }
    return false;
  }

  /**
   * Whether a member may run a given control command.
   *
   * The connected host may do anything. When the host is gone the room elects
   * a stand-in so play can continue, but the stand-in never inherits `kick`:
   * the election is deterministic (first player to join), so granting it would
   * hand a predictable player the power to remove everyone else.
   */
  can(playerId: string, capability: Capability): boolean {
    const player = this.players.get(playerId);
    if (!player?.connected) return false;
    if (player.isHost) return this.hostConnected();
    if (player.isAudience || playerId !== this.controllerPlayerId) return false;
    return !HOST_ONLY_CAPABILITIES.has(capability);
  }

  controlError(
    playerId: string,
    expectedPhaseId: unknown,
    capability: Capability
  ): ApiErrorCode | null {
    if (!Number.isInteger(expectedPhaseId) || expectedPhaseId !== this.phaseId) {
      return "stale_phase";
    }
    return this.can(playerId, capability) ? null : "host_only";
  }

  isEmpty(): boolean {
    for (const player of this.players.values()) {
      if (player.connected) return false;
    }
    return true;
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
      // A paused game must not advance; resume() re-checks instead.
      if (!this.isPaused()) this.engine?.handlePlayerDisconnect?.();
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
    this.unbindPlayer(playerId);
    this.sessionSecrets.delete(playerId);
    this.benched.delete(playerId);
    if (!player.isHost) this.engine?.handlePlayerRemoved?.(playerId);
    if (player.isHost) {
      this.beginControllerFailover();
    } else if (this.controllerPlayerId === playerId) {
      this.controllerPlayerId = null;
      this.electController();
    }
    this.enforcePlayerFloor();
    this.touch();
    this.emit();
  }

  /**
   * A game needs MIN_PLAYERS to be playable. `start` checks that once, but
   * people leave: quiplash pairs author i with author i+1, so a two-player
   * room makes both of them an author of every matchup and nothing is ever
   * votable. End to the scoreboard rather than grinding out empty rounds.
   */
  private enforcePlayerFloor(): void {
    const inPlay =
      this.phase === "answering" ||
      this.phase === "voting" ||
      this.phase === "results";
    if (inPlay && this.realPlayers.length < MIN_PLAYERS) this.endGame();
  }

  private bindSocket(playerId: string, socketId: string): void {
    const previous = this.sockets.get(playerId);
    if (previous) this.socketToPlayer.delete(previous);
    this.sockets.set(playerId, socketId);
    this.socketToPlayer.set(socketId, playerId);
  }

  private unbindPlayer(playerId: string): void {
    const socketId = this.sockets.get(playerId);
    if (socketId) this.socketToPlayer.delete(socketId);
    this.sockets.delete(playerId);
  }

  /** O(1); `currentSession()` calls this on every socket event. */
  pidForSocket(socketId: string): string | null {
    const playerId = this.socketToPlayer.get(socketId);
    // Guard against a stale reverse entry if the forward map moved on.
    return playerId && this.sockets.get(playerId) === socketId ? playerId : null;
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
    this.promoteAudienceToSeats();
    if (this.connectedRealPlayers.length < MIN_PLAYERS) {
      return "not_enough_players";
    }
    const count =
      gameType === "trivia"
        ? clampLength(rounds, MIN_QUESTIONS, MAX_QUESTIONS, TRIVIA_QUESTIONS)
        : gameType === "bluff"
          ? clampLength(rounds, MIN_BLUFF_QUESTIONS, MAX_BLUFF_QUESTIONS, BLUFF_QUESTIONS)
          : clampLength(rounds, MIN_ROUNDS, MAX_ROUNDS, DEFAULT_TOTAL_ROUNDS);
    this.startGame(gameType, count, false);
    return null;
  }

  private startGame(gameType: GameType, rounds: number, isRematch: boolean): void {
    this.clearTimer();
    this.engine?.dispose();
    this.gameType = gameType;
    this.finalView = null;
    this.highlights = null;
    this.gameSettled = false;
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
    const ctx = this.engineContext();
    this.engine =
      gameType === "trivia"
        ? new TriviaEngine(ctx, rounds, previousContent, recordContent)
        : gameType === "bluff"
          ? new BluffEngine(ctx, rounds, previousContent, recordContent)
          : new QuiplashEngine(ctx, rounds, previousContent, recordContent, this.customPrompts);
    this.touch();
    this.engine.start();
  }

  rematch(): ApiErrorCode | null {
    if (this.phase !== "scoreboard" && this.phase !== "gameover") {
      return "invalid_phase";
    }
    if (!this.lastGameConfig) return "invalid_game";
    this.promoteAudienceToSeats();
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
    // Bank the scores while the engine can still name its highlights, keep
    // the round counters for the scoreboard header, then drop the engine so
    // its abandoned mid-round results stop being serialized.
    this.settleGame();
    const view = this.engine?.serialize();
    this.finalView = view
      ? { round: view.round, totalRounds: view.totalRounds }
      : null;
    this.engine?.dispose();
    this.engine = null;
    this.showScoreboard(15);
    return null;
  }

  private showScoreboard(seconds: number): void {
    this.settleGame();
    this.setPhase("scoreboard", seconds, () => this.gameOver());
  }

  /**
   * Bank a finished game into the session standings, exactly once. An early
   * end still counts: those points were earned.
   */
  private settleGame(): void {
    if (this.gameSettled) return;
    this.gameSettled = true;
    this.highlights = this.engine?.highlights?.() ?? [];
    const seated = this.realPlayers;
    const top = Math.max(0, ...seated.map((player) => player.score));
    for (const player of seated) {
      player.sessionScore += player.score;
      if (top > 0 && player.score === top) player.wins += 1;
    }
    this.gamesPlayed += 1;
  }

  /**
   * Skip the current phase's timer.
   *
   * Deliberately unthrottled. Skipping quickly is legitimate — a host clicking
   * through results screens, or a group racing to the scoreboard — and every
   * throttle tried here (a minimum dwell time, a higher token cost) broke that
   * before it inconvenienced anyone abusing it. What bounds the damage is
   * authority, not rate: only the connected host or the elected stand-in can
   * call this, and the worst case is ending a game the room can restart.
   */
  next(): ApiErrorCode | null {
    if (this.phase === "lobby" || this.phase === "gameover" || !this.onTimeout) {
      return "invalid_phase";
    }
    const callback = this.onTimeout;
    // Skipping ahead also ends a pause: the next phase starts on a live clock.
    this.endPause();
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
    this.finalView = null;
    this.highlights = null;
    this.promoteAudienceToSeats();
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

  /**
   * Give connected spectators a seat when one is free. Someone who joined
   * while a game was running expects to play the next one.
   */
  private promoteAudienceToSeats(): void {
    let seated = this.realPlayers.length;
    if (seated >= MAX_PLAYERS) return;
    for (const player of this.players.values()) {
      if (seated >= MAX_PLAYERS) break;
      if (player.connected && player.isAudience && !this.benched.has(player.id)) {
        player.isAudience = false;
        seated += 1;
      }
    }
  }

  /**
   * Lobby only: move a player to the audience or give a spectator a seat.
   * Someone sent to the audience stays there across games until seated again,
   * rather than being promoted straight back at the next start.
   */
  setSeat(targetPlayerId: string, audience: boolean): ApiErrorCode | null {
    if (this.phase !== "lobby") return "invalid_phase";
    const target = this.players.get(targetPlayerId);
    if (!target || target.isHost) return "invalid_target";
    if (target.isAudience === audience) return null;
    if (audience) {
      if (this.isAudienceFull()) return "room_full";
      this.benched.add(targetPlayerId);
    } else {
      if (this.isFull()) return "room_full";
      this.benched.delete(targetPlayerId);
    }
    target.isAudience = audience;
    this.bumpRevision();
    return null;
  }

  /**
   * Lobby only: replace the host's Quiplash prompt pack. Each line gets the
   * same sanitizing as any other user text; blanks and repeats are dropped.
   */
  setCustomPrompts(raw: unknown): { error: ApiErrorCode } | { count: number } {
    if (this.phase !== "lobby") return { error: "invalid_phase" };
    if (!Array.isArray(raw) || raw.length > MAX_CUSTOM_PROMPTS) {
      return { error: "invalid_prompts" };
    }
    const seen = new Set<string>();
    const prompts: string[] = [];
    for (const line of raw) {
      const clean = sanitizeUserText(line, MAX_PROMPT_LEN);
      const key = clean.toLocaleLowerCase();
      if (!clean || seen.has(key)) continue;
      seen.add(key);
      prompts.push(clean);
    }
    this.customPrompts = prompts;
    this.bumpRevision();
    return { count: prompts.length };
  }

  // ---- pause ----

  isPaused(): boolean {
    return this.pausedRemainingMs !== null;
  }

  /**
   * Freeze the phase clock. Gameplay submissions are refused until resume, so
   * nothing can complete a phase behind a frozen timer.
   */
  pause(): ApiErrorCode | null {
    if (this.isPaused() || !this.timerHandle || !this.onTimeout || this.deadlineMono === null) {
      return "invalid_phase";
    }
    const now = this.monotonicNow();
    this.pausedRemainingMs = Math.max(0, this.deadlineMono - now);
    this.pausedAtMono = now;
    clearTimeout(this.timerHandle);
    this.timerHandle = null;
    this.deadlineMono = null;
    this.phaseEndsAt = null;
    this.engine?.pause?.();
    this.bumpRevision();
    return null;
  }

  resume(): ApiErrorCode | null {
    const remaining = this.pausedRemainingMs;
    const callback = this.onTimeout;
    if (remaining === null || !callback) return "invalid_phase";
    this.endPause();
    this.armTimer(remaining, callback);
    this.bumpRevision();
    // Players who dropped while paused, or everyone having finished, were not
    // acted on while frozen.
    this.engine?.handlePlayerDisconnect?.();
    return null;
  }

  private endPause(): void {
    if (this.pausedRemainingMs === null) return;
    this.pausedTotalMs += this.monotonicNow() - this.pausedAtMono;
    this.pausedRemainingMs = null;
  }

  /** The clock engines see: monotonic time with every pause cut out. */
  private gameNow(): number {
    const now = this.isPaused() ? this.pausedAtMono : this.monotonicNow();
    return now - this.pausedTotalMs;
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

  submitLie(playerId: string, questionId: string, text: string): ApiErrorCode | null {
    if (this.phase !== "answering" || !this.engine?.handleLie) return "submit_failed";
    const error = this.engine.handleLie(playerId, questionId, text);
    if (!error) this.touch();
    return error;
  }

  submitPick(playerId: string, questionId: string, optionId: string): boolean {
    if (this.phase !== "voting") return false;
    const accepted = this.engine?.handlePick?.(playerId, questionId, optionId) ?? false;
    if (accepted) this.touch();
    return accepted;
  }

  // ---- engine context and phase deadline ----

  private engineContext(): EngineContext {
    return {
      language: this.language,
      players: () => this.realPlayers,
      connectedPlayers: () => this.connectedRealPlayers,
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
      toScoreboard: (seconds) => this.showScoreboard(seconds),
      now: () => this.gameNow(),
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
    // Anything that moves the game on — a kick, the player floor, a skip —
    // starts the new phase on a live clock.
    this.endPause();
    this.clearTimer();
    this.phase = phase;
    this.phaseId += 1;
    this.phaseBumpPending = false;
    this.onTimeout = onTimeout;
    if (seconds !== null && onTimeout) this.armTimer(seconds * 1000, onTimeout);
    this.emit();
  }

  private armTimer(ms: number, onTimeout: () => void): void {
    if (this.timerHandle) clearTimeout(this.timerHandle);
    this.onTimeout = onTimeout;
    this.deadlineMono = this.monotonicNow() + ms;
    this.phaseEndsAt = this.wallNow() + ms;
    this.timerHandle = setTimeout(() => {
      const callback = this.onTimeout;
      this.clearTimer();
      callback?.();
    }, ms);
    this.timerHandle.unref();
  }

  /**
   * Invalidate in-flight control commands without changing phase.
   *
   * The increment is deferred to the flush so a single user action that both
   * mutates the room and bumps the revision produces exactly one increment —
   * two would invalidate the caller's own next command.
   */
  private bumpRevision(): void {
    this.phaseBumpPending = true;
    this.touch();
    this.emit();
  }

  private clearTimer(): void {
    if (this.timerHandle) clearTimeout(this.timerHandle);
    this.timerHandle = null;
    this.deadlineMono = null;
    this.phaseEndsAt = null;
    this.onTimeout = null;
  }

  private buildState(): RoomState {
    const view = this.engine?.serialize();
    const players: Player[] = [];
    const audience: RoomState["audience"] = [];
    let hostConnected = false;
    const progress = { submitted: 0, voted: 0 };
    // Quiplash judges answers anonymously, and per-player progress gives that
    // away: whoever has not answered wrote the canned safety quip, and the
    // connected players who have not voted on a matchup are its two authors.
    // Broadcast the counts the UI actually shows and blank the flags. Audience
    // flags stay as they are — nobody in the audience writes anything.
    const anonymousProgress =
      this.gameType === "quiplash" &&
      (this.phase === "answering" || this.phase === "voting");
    // One pass instead of the four separate filters this used to run.
    for (const player of this.players.values()) {
      if (player.isHost) {
        hostConnected ||= player.connected;
      } else if (player.isAudience) {
        if (player.connected && player.hasVoted) progress.voted += 1;
        audience.push({
          id: player.id,
          name: player.name,
          avatar: player.avatar,
          connected: player.connected,
          hasVoted: player.hasVoted,
        });
      } else {
        if (player.connected && player.hasSubmitted) progress.submitted += 1;
        if (player.connected && player.hasVoted) progress.voted += 1;
        players.push(
          anonymousProgress
            ? { ...player, hasSubmitted: false, hasVoted: false }
            : { ...player }
        );
      }
    }
    return {
      code: this.code,
      phase: this.phase,
      gameType: this.gameType,
      language: this.language,
      round: view?.round ?? this.finalView?.round ?? 0,
      totalRounds: view?.totalRounds ?? this.finalView?.totalRounds ?? 0,
      players,
      audience,
      hostConnected,
      phaseId: this.phaseId,
      phaseEndsAt: this.phaseEndsAt,
      serverNow: this.wallNow(),
      controllerPlayerId: this.controllerPlayerId,
      progress,
      pausedRemainingMs: this.pausedRemainingMs,
      gamesPlayed: this.gamesPlayed,
      customPromptCount: this.customPrompts.length,
      highlights:
        this.phase === "scoreboard" || this.phase === "gameover"
          ? this.highlights
          : null,
      quiplash: view?.quiplash,
      trivia: view?.trivia,
      bluff: view?.bluff,
    };
  }

  /** Queue a broadcast; several mutations in one turn collapse into one. */
  emit(): void {
    if (this.broadcastPending) return;
    this.broadcastPending = true;
    queueMicrotask(() => this.flush());
  }

  /**
   * Send the queued broadcast now.
   *
   * The socket layer calls this at the end of each handler so clients see the
   * new state before the acknowledgement that caused it.
   */
  flush(): void {
    if (!this.broadcastPending) return;
    this.broadcastPending = false;
    if (this.phaseBumpPending) {
      this.phaseBumpPending = false;
      this.phaseId += 1;
    }
    this.broadcast(this.buildState());
  }

  private touch(): void {
    this.lastActivity = this.wallNow();
  }

  /**
   * Reclaimable when everyone has dropped and gone quiet, or when the room has
   * been silent for the hard limit regardless of connections — otherwise a
   * single forgotten browser tab pins a room slot forever.
   */
  isStale(maxIdleMs: number, abandonedIdleMs = maxIdleMs / 6): boolean {
    const idleMs = this.wallNow() - this.lastActivity;
    if (idleMs > maxIdleMs) return true;
    return this.isEmpty() && idleMs > abandonedIdleMs;
  }

  // ---- restart persistence ----

  /** Everything needed to rebuild this room in a fresh process. */
  toSnapshot(): RoomSnapshot {
    const remainingMs = this.isPaused()
      ? this.pausedRemainingMs
      : this.deadlineMono === null
        ? null
        : Math.max(0, this.deadlineMono - this.monotonicNow());
    return {
      version: ROOM_SNAPSHOT_VERSION,
      code: this.code,
      language: this.language,
      players: [...this.players.values()].map((player) => ({ ...player })),
      sessionSecrets: [...this.sessionSecrets].map(([id, hash]) => [id, hash.toString("hex")]),
      phase: this.phase,
      phaseId: this.phaseId,
      remainingMs,
      paused: this.isPaused(),
      gameType: this.gameType,
      lastGameConfig: this.lastGameConfig,
      recentContent: {
        quiplash: [...this.recentContent.quiplash],
        trivia: [...this.recentContent.trivia],
        bluff: [...this.recentContent.bluff],
      },
      customPrompts: [...this.customPrompts],
      benched: [...this.benched],
      gamesPlayed: this.gamesPlayed,
      gameSettled: this.gameSettled,
      highlights: this.highlights,
      finalView: this.finalView,
      engine: this.engine?.snapshot() ?? null,
    };
  }

  /**
   * Rebuild a room saved by `toSnapshot()` in another process.
   *
   * Every socket died with that process, so everyone comes back disconnected
   * and holding the usual lease: their stored resume token reattaches them,
   * and anyone who never returns expires as after any other disconnect. A
   * running phase gets a grace period so the room has time to reconnect.
   */
  static fromSnapshot(
    snapshot: RoomSnapshot,
    broadcast: Broadcast,
    sendAssignment: AssignmentSender,
    options: RoomLifecycleOptions = {}
  ): Room {
    if (snapshot.version !== ROOM_SNAPSHOT_VERSION) {
      throw new Error(`unsupported room snapshot version ${snapshot.version}`);
    }
    const room = new Room(snapshot.code, snapshot.language, broadcast, sendAssignment, options);
    for (const player of snapshot.players) {
      room.players.set(player.id, { ...player, connected: false });
    }
    for (const [id, hex] of snapshot.sessionSecrets) {
      if (room.players.has(id)) room.sessionSecrets.set(id, Buffer.from(hex, "hex"));
    }
    room.phase = snapshot.phase;
    // Invalidate any control command a client composed before the restart.
    room.phaseId = snapshot.phaseId + 1;
    room.gameType = snapshot.gameType;
    room.lastGameConfig = snapshot.lastGameConfig;
    for (const type of GAME_TYPES) {
      room.recentContent[type] = new Set(snapshot.recentContent[type] ?? []);
    }
    room.customPrompts = snapshot.customPrompts;
    room.benched = new Set(snapshot.benched.filter((id) => room.players.has(id)));
    room.gamesPlayed = snapshot.gamesPlayed;
    room.gameSettled = snapshot.gameSettled;
    room.highlights = snapshot.highlights;
    room.finalView = snapshot.finalView;

    if (snapshot.engine) {
      const type = snapshot.engine.type;
      const record = (key: string): void => {
        room.recentContent[type].add(key);
      };
      const ctx = room.engineContext();
      room.engine =
        type === "trivia"
          ? TriviaEngine.restore(ctx, snapshot.engine.data, record)
          : type === "bluff"
            ? BluffEngine.restore(ctx, snapshot.engine.data, record)
            : QuiplashEngine.restore(ctx, snapshot.engine.data, record);
    }

    const callback =
      room.phase === "scoreboard" ? () => room.gameOver() : room.engine?.timeoutHandler() ?? null;
    if (TIMED_PHASES.has(room.phase) && snapshot.remainingMs !== null && callback) {
      if (snapshot.paused) {
        room.onTimeout = callback;
        room.pausedRemainingMs = snapshot.remainingMs;
        room.pausedAtMono = room.monotonicNow();
      } else {
        room.armTimer(snapshot.remainingMs + room.restoreGraceMs, callback);
      }
    } else if (room.phase !== "lobby" && room.phase !== "gameover") {
      // A game phase with nothing to drive it would never end; start over.
      room.engine?.dispose();
      room.engine = null;
      room.gameType = null;
      room.phase = "lobby";
    }

    for (const playerId of room.players.keys()) room.scheduleMemberExpiry(playerId);
    room.beginControllerFailover();
    room.touch();
    return room;
  }

  dispose(): void {
    this.clearTimer();
    this.engine?.dispose();
    this.broadcastPending = false;
    this.phaseBumpPending = false;
    for (const handle of this.memberExpiry.values()) clearTimeout(handle);
    this.memberExpiry.clear();
    if (this.controllerTimer) clearTimeout(this.controllerTimer);
    this.controllerTimer = null;
  }
}
