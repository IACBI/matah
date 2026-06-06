// Shared types & contracts between the Quibble server and client.

export type Language = "tr" | "en" | "de" | "es";
export const LANGUAGES: Language[] = ["tr", "en", "de", "es"];

export type GameType = "quiplash" | "trivia";
export const GAME_TYPES: GameType[] = ["quiplash", "trivia"];

export type GamePhase =
  | "lobby" // waiting for players + game selection
  | "answering" // quiplash: typing answers / trivia: picking an option
  | "voting" // quiplash only: vote on answer pairs
  | "results" // round/question results
  | "scoreboard" // final scoreboard
  | "gameover";

export interface Player {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  isHost: boolean; // the TV/host screen — displays only, never plays
  hasSubmitted: boolean; // answered this round/question
  hasVoted: boolean; // quiplash: voted on the active matchup
  streak: number; // trivia: consecutive correct answers
}

// ---- Quiplash ----

export interface Matchup {
  id: string;
  prompt: string;
  answers: { playerId: string; playerName: string; text: string }[];
  votes: Record<string, string>; // voterId -> answer playerId
}

export interface MatchupResult {
  prompt: string;
  answers: {
    playerId: string;
    playerName: string;
    text: string;
    votes: number;
    pointsAwarded: number;
  }[];
}

export interface QuiplashView {
  currentMatchupIndex: number;
  totalMatchups: number;
  activeMatchup: Pick<Matchup, "id" | "prompt" | "answers"> | null;
  lastResults: MatchupResult[] | null;
}

/** Personalized prompts a player must answer (quiplash answering phase). */
export interface PlayerAssignment {
  prompts: { matchupId: string; prompt: string }[];
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

// ---- Public room state broadcast to everyone ----

export interface RoomState {
  code: string;
  phase: GamePhase;
  gameType: GameType | null; // null until the host starts a game
  language: Language; // content language for prompts/questions
  round: number;
  totalRounds: number;
  players: Player[];
  timer: number | null;
  quiplash?: QuiplashView;
  trivia?: TriviaView;
}

// ---- Socket.IO event contracts ----

export interface ClientToServerEvents {
  "room:create": (
    payload: { language: Language },
    cb: (res: ApiResult<{ code: string; playerId: string }>) => void
  ) => void;
  "room:join": (
    payload: { code: string; name: string },
    cb: (res: ApiResult<{ code: string; playerId: string }>) => void
  ) => void;
  "room:rejoin": (
    payload: { code: string; playerId: string },
    cb: (res: ApiResult<{ code: string; playerId: string }>) => void
  ) => void;
  "game:start": (
    payload: { gameType: GameType },
    cb: (res: ApiResult<null>) => void
  ) => void;
  "game:next": (cb: (res: ApiResult<null>) => void) => void;
  "game:restart": (cb: (res: ApiResult<null>) => void) => void;
  "answer:submit": (
    payload: { matchupId: string; text: string },
    cb: (res: ApiResult<null>) => void
  ) => void;
  "vote:submit": (
    payload: { matchupId: string; answerPlayerId: string },
    cb: (res: ApiResult<null>) => void
  ) => void;
  "trivia:answer": (
    payload: { questionId: string; optionIndex: number },
    cb: (res: ApiResult<null>) => void
  ) => void;
}

export interface ServerToClientEvents {
  "room:state": (state: RoomState) => void;
  "player:assignment": (assignment: PlayerAssignment) => void;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ---- Tunables ----

export const ROOM_CODE_LENGTH = 4;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const DEFAULT_TOTAL_ROUNDS = 3;
export const TRIVIA_QUESTIONS = 6;

// Validation limits (shared so client and server agree).
export const MAX_NAME_LEN = 16;
export const MAX_ANSWER_LEN = 120;
