// Shared types & contracts between the Matah server and client.

export type Language = "tr" | "en" | "de" | "es" | "fr" | "it" | "pt" | "ru" | "ar" | "zh" | "ja" | "ko" | "hi" | "nl";
export const LANGUAGES: Language[] = ["tr", "en", "de", "es", "fr", "it", "pt", "ru", "ar", "zh", "ja", "ko", "hi", "nl"];

export type GameType = "quiplash" | "trivia" | "bluff";
export const GAME_TYPES: GameType[] = ["quiplash", "trivia", "bluff"];

export type GamePhase =
  | "lobby" // waiting for players + game selection
  | "answering" // quiplash: typing answers / trivia: picking an option / bluff: writing lies
  | "voting" // quiplash: vote on answer pairs / bluff: hunt for the truth
  | "results" // round/question results
  | "scoreboard" // final scoreboard
  | "gameover";

export interface Player {
  id: string;
  name: string;
  avatar: string; // avatar id picked at join time (rendered as an SVG)
  score: number;
  connected: boolean;
  isHost: boolean; // the TV/host screen — displays only, never plays
  isAudience: boolean; // joined late / room full — votes but never answers
  hasSubmitted: boolean; // answered this round/question
  hasVoted: boolean; // quiplash: voted on the active matchup
  streak: number; // trivia: consecutive correct answers
  /** Points banked from every finished game in this room. */
  sessionScore: number;
  /** Finished games this player topped (ties count for everyone tied). */
  wins: number;
}

/** A person named on a results screen: who wrote or picked something. */
export interface Credit {
  name: string;
  avatar: string;
}

// ---- Quiplash ----

export interface Matchup {
  id: string;
  prompt: string;
  answers: {
    answerId: string;
    playerId: string;
    playerName: string;
    text: string;
    isSafety: boolean;
  }[];
  votes: Record<string, string>; // voterId -> answerId
}

export interface MatchupResult {
  prompt: string;
  answers: {
    playerId: string;
    playerName: string;
    text: string;
    isSafety: boolean;
    votes: number;
    /** Points from vote share alone. */
    pointsAwarded: number;
    /** Flat reward for having written anything; 0 for safety quips. */
    submitBonus: number;
    /** Who voted for this answer. Voting is over, so this is no longer secret. */
    voters: Credit[];
  }[];
}

export interface QuiplashView {
  currentMatchupIndex: number;
  totalMatchups: number;
  activeMatchup: {
    id: string;
    prompt: string;
    answers: { answerId: string; text: string }[];
  } | null;
  lastResults: MatchupResult[] | null;
}

/** Personalized prompts a player must answer (quiplash answering phase). */
export interface PlayerAssignment {
  prompts: { matchupId: string; prompt: string; submitted: boolean }[];
  /**
   * The matchup this player has already voted on, if any. Quiplash strips the
   * per-player vote flags out of `RoomState`, because the connected players who
   * have *not* voted on a matchup are exactly the two who wrote it, so a
   * reconnecting voter recovers that one bit through this private channel.
   */
  votedMatchupId: string | null;
  /** Bluff mode: this player's own view of the current question. */
  bluff?: {
    questionId: string;
    /** Whether their lie is in. */
    submitted: boolean;
    /** Options that are this player's own lie, which they may not pick. */
    ownOptionIds: string[];
    pickedOptionId: string | null;
  };
}

// ---- Trivia ----

export interface TriviaView {
  questionIndex: number;
  totalQuestions: number;
  // The active question (correct answer hidden during the answering phase).
  question: { id: string; text: string; options: string[] } | null;
  // Revealed during the results phase.
  reveal: {
    correctIndex: number;
    counts: number[]; // votes per option
    pointsThisRound: { playerId: string; playerName: string; points: number }[];
  } | null;
}

// ---- Bluff ----

export interface BluffOptionReveal {
  optionId: string;
  text: string;
  isTruth: boolean;
  /** Who wrote this lie; empty for the truth and for house decoys. */
  authors: Credit[];
  /** Who picked this option. */
  pickers: Credit[];
}

export interface BluffView {
  questionIndex: number;
  totalQuestions: number;
  question: { id: string; text: string } | null;
  /** Shuffled once per question; present while picking and on the reveal. */
  options: { optionId: string; text: string }[] | null;
  reveal: {
    options: BluffOptionReveal[];
    pointsThisRound: { playerId: string; playerName: string; points: number }[];
  } | null;
}

/** A standout moment of a finished game, shown on the scoreboard. */
export interface Highlight {
  kind: "quip" | "lie";
  prompt: string;
  text: string;
  authors: Credit[];
  /** Votes for a quip; players fooled by a lie. */
  votes: number;
}

// ---- Public room state broadcast to everyone ----

export interface RoomState {
  code: string;
  phase: GamePhase;
  gameType: GameType | null; // null until the host starts a game
  language: Language; // content language for prompts/questions
  round: number;
  totalRounds: number;
  players: Player[]; // active (non-host, non-audience) players
  // Audience members vote in quiplash, so `hasVoted` is part of their public
  // shape; nothing else about them is broadcast.
  audience: Pick<Player, "id" | "name" | "avatar" | "connected" | "hasVoted">[];
  hostConnected: boolean; // false → players may take over host controls
  /** Monotonically increasing guard for control commands. */
  phaseId: number;
  /** Unix epoch milliseconds when the current phase expires. */
  phaseEndsAt: number | null;
  /** Server clock sample paired with phaseEndsAt for client clock-offset handling. */
  serverNow: number;
  /** Elected player controller while the host is unavailable; null otherwise. */
  controllerPlayerId: string | null;
  /**
   * Aggregate answering and voting progress. Quiplash blanks the per-player
   * flags in `players` while answering and voting — "who has not answered yet"
   * pins which displayed answer is real, and "who has not voted" names a
   * matchup's authors — so progress UI counts from here instead. `submitted`
   * covers connected players; `voted` covers connected players and audience.
   */
  progress: { submitted: number; voted: number };
  /**
   * Time left on the frozen clock while the game is paused; null when it is
   * running. `phaseEndsAt` is null while paused.
   */
  pausedRemainingMs: number | null;
  /** Games finished in this room; session standings are shown from 2 on. */
  gamesPlayed: number;
  /** How many host-written Quiplash prompts are loaded. */
  customPromptCount: number;
  /** The best moments of the game just finished; null outside the scoreboard. */
  highlights: Highlight[] | null;
  quiplash?: QuiplashView;
  trivia?: TriviaView;
  bluff?: BluffView;
}

// ---- Socket.IO event contracts ----

export interface ClientToServerEvents {
  "room:create": (
    payload: { language: Language },
    cb: (res: ApiResult<SessionResult>) => void
  ) => void;
  "room:join": (
    payload: { code: string; name: string; avatar?: string },
    cb: (
      res: ApiResult<SessionResult>
    ) => void
  ) => void;
  "room:rejoin": (
    payload: { code: string; resumeToken: string },
    cb: (res: ApiResult<SessionResult>) => void
  ) => void;
  "room:leave": (cb: (res: ApiResult<null>) => void) => void;
  "room:setLanguage": (
    payload: { language: Language; phaseId: number },
    cb: (res: ApiResult<null>) => void
  ) => void;
  "game:start": (
    // `rounds` is the desired length (quiplash rounds / trivia questions);
    // the server clamps it to the mode's allowed range.
    payload: { gameType: GameType; rounds?: number; phaseId: number },
    cb: (res: ApiResult<null>) => void
  ) => void;
  "game:next": (
    payload: { phaseId: number },
    cb: (res: ApiResult<null>) => void
  ) => void;
  "game:restart": (
    payload: { phaseId: number },
    cb: (res: ApiResult<null>) => void
  ) => void;
  "game:rematch": (
    payload: { phaseId: number },
    cb: (res: ApiResult<null>) => void
  ) => void;
  "game:end": (
    payload: { phaseId: number },
    cb: (res: ApiResult<null>) => void
  ) => void;
  "player:kick": (
    payload: { playerId: string; phaseId: number },
    cb: (res: ApiResult<null>) => void
  ) => void;
  "answer:submit": (
    payload: { matchupId: string; text: string },
    cb: (res: ApiResult<null>) => void
  ) => void;
  "vote:submit": (
    payload: { matchupId: string; answerId: string },
    cb: (res: ApiResult<null>) => void
  ) => void;
  "trivia:answer": (
    payload: { questionId: string; optionIndex: number },
    cb: (res: ApiResult<null>) => void
  ) => void;
  "reaction:send": (
    payload: { emoji: string },
    cb: (res: ApiResult<null>) => void
  ) => void;
  "game:pause": (
    payload: { phaseId: number },
    cb: (res: ApiResult<null>) => void
  ) => void;
  "game:resume": (
    payload: { phaseId: number },
    cb: (res: ApiResult<null>) => void
  ) => void;
  /** Lobby only: move a player to the audience (`audience: true`) or back. */
  "player:setSeat": (
    payload: { playerId: string; audience: boolean; phaseId: number },
    cb: (res: ApiResult<null>) => void
  ) => void;
  /** Lobby only: replace the room's custom Quiplash prompts; [] clears them. */
  "room:setCustomPrompts": (
    payload: { prompts: string[]; phaseId: number },
    cb: (res: ApiResult<{ count: number }>) => void
  ) => void;
  "bluff:lie": (
    payload: { questionId: string; text: string },
    cb: (res: ApiResult<null>) => void
  ) => void;
  "bluff:pick": (
    payload: { questionId: string; optionId: string },
    cb: (res: ApiResult<null>) => void
  ) => void;
}

export interface Reaction {
  playerId: string;
  name: string;
  avatar: string;
  emoji: string;
}

export interface ServerToClientEvents {
  "room:state": (state: RoomState) => void;
  "player:assignment": (assignment: PlayerAssignment) => void;
  "room:reaction": (reaction: Reaction) => void;
  /** The host removed this client from the room. */
  "room:kicked": () => void;
  /** A newer connection resumed this session. */
  "room:session-replaced": () => void;
}

export interface SessionResult {
  code: string;
  playerId: string;
  resumeToken: string;
  isAudience: boolean;
}

export type ApiErrorCode =
  | "already_started"
  | "answer_is_truth"
  | "game_paused"
  | "host_only"
  | "invalid_game"
  | "invalid_language"
  | "invalid_phase"
  | "invalid_prompts"
  | "invalid_reaction"
  | "invalid_target"
  | "name_required"
  | "no_room"
  | "not_enough_players"
  | "rate_limited"
  | "room_full"
  | "room_not_found"
  | "server_busy"
  | "server_error"
  | "session_not_found"
  | "stale_phase"
  | "submit_failed"
  | "vote_failed";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiErrorCode };

/**
 * What a control command needs permission to do.
 *
 * The connected host holds every capability. When the host drops, the room
 * elects a player controller so the game can continue — but the stand-in never
 * gets `kick`, `seat` or `content`: those act on other people or put words on
 * everyone's screen. Everything else is game flow the room can recover from.
 */
export type Capability =
  | "start"
  | "advance"
  | "end"
  | "restart"
  | "rematch"
  | "language"
  | "pause"
  | "kick"
  | "seat"
  | "content";

// ---- Tunables ----

export const ROOM_CODE_LENGTH = 4;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const MAX_AUDIENCE = 20;
export const DEFAULT_TOTAL_ROUNDS = 3;
export const TRIVIA_QUESTIONS = 6;
/** The last trivia question is worth double points. */
export const TRIVIA_FINAL_MULTIPLIER = 2;

// ---- Quiplash scoring ----
//
// Each matchup pays out a pool split by vote share, scaled by the round
// number. Two rules keep it fair:
//
//  - The pool scales with how many of the answers are real. A matchup with one
//    human and one canned safety quip pays half, so being paired with someone
//    who timed out is no longer the highest-scoring event in the game.
//  - Votes for a safety quip count in the denominator, so vote share means
//    "share of the room" rather than "share of the humans".
//
// On top of that every submitted answer earns a flat bonus, so writing
// something always beats letting the clock run out.
export const MATCHUP_POINT_POOL = 1_000;
export const SUBMIT_BONUS = 100;

// Host-configurable game length, clamped per mode (see Room.start).
export const MIN_ROUNDS = 1; // quiplash rounds
export const MAX_ROUNDS = 5;
export const MIN_QUESTIONS = 3; // trivia questions (pool has 32 per language)
export const MAX_QUESTIONS = 10;
export const BLUFF_QUESTIONS = 4;
export const MIN_BLUFF_QUESTIONS = 2;
export const MAX_BLUFF_QUESTIONS = 8;
/** Bluff scoring, doubled on the final question. */
export const BLUFF_TRUTH_POINTS = 500;
export const BLUFF_FOOL_POINTS = 250;

/** Clamp a requested length into [min, max], falling back to a default. */
export function clampLength(
  requested: number | undefined,
  min: number,
  max: number,
  fallback: number
): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(requested)));
}

// Validation limits (shared so client and server agree).
export const MAX_NAME_LEN = 16;
export const MAX_ANSWER_LEN = 120;
export const MAX_LIE_LEN = 60;
/** Custom prompt packs: sized so a full pack fits one Socket.IO frame. */
export const MAX_CUSTOM_PROMPTS = 30;
export const MAX_PROMPT_LEN = 90;

// Avatar ids players can pick from (rendered as animated SVGs on the client;
// server validates against this list). See client Avatar.tsx for the art.
export const AVATARS = [
  "cool", "fox", "cat", "frog", "unicorn", "ghost", "robot", "panda",
  "octopus", "lion", "pizza", "rocket", "cactus", "cupcake", "dragon", "ninja",
] as const;
export const DEFAULT_AVATAR = "smiley";

// Reaction ids anyone can fire at the host screen during a game (rendered as
// animated SVGs client-side).
export const REACTIONS = ["laugh", "heart", "fire", "clap", "wow", "skull"] as const;
