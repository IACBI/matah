import type {
  GamePhase,
  GameType,
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
  /** Active (non-host, non-audience) players. */
  players(): Player[];
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
  now(): number;
}

export interface EngineView {
  round: number;
  totalRounds: number;
  quiplash?: QuiplashView;
  trivia?: TriviaView;
}

/** A playable game mode. Optional handlers are ignored if the mode doesn't use them. */
export interface GameEngine {
  readonly type: GameType;
  start(): void;
  handleAnswer?(playerId: string, matchupId: string, text: string): boolean;
  handleVote?(playerId: string, matchupId: string, answerPlayerId: string): boolean;
  handleTriviaAnswer?(
    playerId: string,
    questionId: string,
    optionIndex: number
  ): boolean;
  /** The per-player data to (re)send, e.g. after a reconnect. Null if none. */
  currentAssignment?(playerId: string): PlayerAssignment | null;
  /**
   * A player went offline mid-game. Lets the engine re-check its
   * "everyone done?" conditions so a dropped player doesn't stall the round.
   */
  handlePlayerDisconnect?(playerId: string): void;
  serialize(): EngineView;
  dispose(): void;
}
