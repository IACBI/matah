import type {
  ApiErrorCode,
  BluffView,
  GamePhase,
  GameType,
  Highlight,
  Language,
  Player,
  PlayerAssignment,
  QuiplashView,
  TriviaView,
} from "../../shared/src/index.js";

/**
 * Services the Room exposes to a game engine. Engines never touch the socket
 * layer directly — they drive the phase timeline and award points through here.
 */
export interface EngineContext {
  readonly language: Language;
  /** Active (non-host, non-audience) players, including offline ones. */
  players(): Player[];
  /**
   * Players who are online right now. Use this to size a round: a player
   * holding a disconnect lease cannot answer, and handing them prompts only
   * publishes a canned safety quip under their name.
   */
  connectedPlayers(): Player[];
  /** Audience members (may vote in quiplash, never answer). */
  audience(): Player[];
  getPlayer(id: string): Player | undefined;
  /** Like getPlayer but also returns audience members (they may vote). */
  getParticipant(id: string): Player | undefined;
  setPhase(
    phase: GamePhase,
    seconds: number | null,
    onTimeout: (() => void) | null
  ): void;
  emit(): void;
  sendAssignment(playerId: string, assignment: PlayerAssignment): void;
  award(playerId: string, points: number): void;
  resetFlags(): void;
  /** Show the final scoreboard, then end the game. */
  toScoreboard(seconds: number): void;
  /**
   * Monotonic milliseconds for gameplay timing. The clock stops while the room
   * is paused, so elapsed-time scoring never counts a pause against anyone.
   */
  now(): number;
}

export interface EngineView {
  round: number;
  totalRounds: number;
  quiplash?: QuiplashView;
  trivia?: TriviaView;
  bluff?: BluffView;
}

/** Plain JSON an engine can be rebuilt from after a server restart. */
export interface EngineSnapshot {
  type: GameType;
  data: unknown;
}

/** A playable game mode. Optional handlers are ignored if the mode doesn't use them. */
export interface GameEngine {
  readonly type: GameType;
  start(): void;
  handleAnswer?(playerId: string, matchupId: string, text: string): boolean;
  handleVote?(playerId: string, matchupId: string, answerId: string): boolean;
  handleTriviaAnswer?(
    playerId: string,
    questionId: string,
    optionIndex: number
  ): boolean;
  /** Bluff: a player's lie. Null on success, otherwise why it was refused. */
  handleLie?(playerId: string, questionId: string, text: string): ApiErrorCode | null;
  handlePick?(playerId: string, questionId: string, optionId: string): boolean;
  /** The per-player data to (re)send, e.g. after a reconnect. Null if none. */
  currentAssignment?(playerId: string): PlayerAssignment | null;
  /**
   * Re-check the "everyone done?" conditions. Called when a player goes
   * offline mid-game, so a dropped player doesn't stall the round, and when a
   * paused game resumes, since nothing advanced while it was frozen.
   */
  handlePlayerDisconnect?(): void;
  /** The room froze its clock: cancel any engine-owned timers. */
  pause?(): void;
  /**
   * A player was removed from the room entirely (kicked). Unlike a disconnect,
   * they are never coming back, so the engine must purge any state they left
   * behind (answers, votes) so it can't be displayed, voted on, or scored.
   */
  handlePlayerRemoved?(playerId: string): void;
  serialize(): EngineView;
  /** The game's best moments, for the scoreboard. */
  highlights?(): Highlight[];
  /**
   * What the room's phase timer should run for the engine's current phase.
   * Timers are closures and cannot be saved, so a restored engine hands its
   * room the callback to re-arm.
   */
  timeoutHandler(): (() => void) | null;
  snapshot(): EngineSnapshot;
  dispose(): void;
}
