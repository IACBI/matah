import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  GamePhase,
  GameType,
  Language,
  RoomState,
} from "../../../shared/src/index";
import {
  DEFAULT_TOTAL_ROUNDS,
  MAX_QUESTIONS,
  MAX_ROUNDS,
  MIN_PLAYERS,
  MIN_QUESTIONS,
  MIN_ROUNDS,
  TRIVIA_QUESTIONS,
  LANGUAGES,
} from "../../../shared/src/index";
import { emitAck, type ClientResult } from "../socket";
import { useI18n } from "../i18n";
import { errorKey, LANGUAGE_LABELS } from "../i18n/translations";
import { TopBar } from "../components/Controls";
import { Confetti } from "../components/Confetti";
import { ReactionOverlay } from "../components/Reactions";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { QuiplashIcon, TriviaIcon } from "../components/GameIcons";
import { Avatar } from "../components/Avatar";
import { IconCheck, IconClose, IconCopy, Medal, PartyIcon } from "../components/icons";
import { playSfx } from "../sound";

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

interface Props {
  code: string;
  state: RoomState | null;
  secondsLeft: number | null;
  connected: boolean;
  leaving: boolean;
  onLeave: () => Promise<void>;
}

export function HostScreen({
  code,
  state,
  secondsLeft,
  connected,
  leaving,
  onLeave,
}: Props) {
  const { t } = useI18n();
  const [pending, setPending] = useState<string | null>(null);
  const [commandError, setCommandError] = useState("");
  const pendingRef = useRef(false);

  const runCommand = useCallback(
    async (name: string, action: () => Promise<ClientResult<null>>) => {
      if (pendingRef.current) return false;
      pendingRef.current = true;
      setPending(name);
      setCommandError("");
      const result = await action();
      if (!result.ok) setCommandError(t(errorKey(result.error)));
      pendingRef.current = false;
      setPending(null);
      return result.ok;
    },
    [t]
  );

  const start = async (gameType: GameType, rounds: number) => {
    if (!state) return;
    const ok = await runCommand("start", () =>
      emitAck<null>("game:start", { gameType, rounds, phaseId: state.phaseId })
    );
    if (ok) playSfx("submit");
  };
  const next = async () => {
    if (!state) return;
    const ok = await runCommand("next", () =>
      emitAck<null>("game:next", { phaseId: state.phaseId })
    );
    if (ok) playSfx("click");
  };
  const kick = async (playerId: string) => {
    if (!state) return;
    const ok = await runCommand("kick", () =>
      emitAck<null>("player:kick", { playerId, phaseId: state.phaseId })
    );
    if (ok) playSfx("click");
  };
  const setGameLanguage = async (language: Language) => {
    if (!state) return;
    await runCommand("language", () =>
      emitAck<null>("room:setLanguage", { language, phaseId: state.phaseId })
    );
  };
  // Confirmations run through a styled dialog; `confirming` holds which one.
  const [confirming, setConfirming] = useState<"end" | "leave" | null>(null);

  const endGame = async () => {
    if (!state) return;
    const ok = await runCommand("end", () =>
      emitAck<null>("game:end", { phaseId: state.phaseId })
    );
    if (ok) playSfx("click");
  };
  const leaveGame = () => {
    playSfx("click");
    void onLeave();
  };
  const askLeave = () => {
    const inProgress =
      !!state &&
      state.phase !== "lobby" &&
      state.phase !== "gameover" &&
      state.phase !== "scoreboard";
    if (inProgress) setConfirming("leave");
    else leaveGame();
  };

  // Sound cues on phase transitions.
  const prevPhase = useRef<GamePhase | null>(null);
  const prevPlayerCount = useRef(0);
  useEffect(() => {
    if (!state) return;
    if (state.players.length > prevPlayerCount.current) playSfx("join");
    prevPlayerCount.current = state.players.length;

    if (prevPhase.current !== state.phase) {
      if (state.phase === "voting") playSfx("reveal");
      if (state.phase === "results") playSfx("reveal");
      if (state.phase === "scoreboard") playSfx("win");
      prevPhase.current = state.phase;
    }
  }, [state]);

  if (!state) {
    return (
      <div className="screen host center">
        <TopBar />
        <div className="badge warn">
          {connected ? t("preparingRoom") : t("connecting")}
        </div>
        <button className="btn link host-leave-center" onClick={askLeave} disabled={leaving}>
          {t("leaveRoom")}
        </button>
      </div>
    );
  }

  const isFinalRound =
    state.round > 0 &&
    state.totalRounds > 0 &&
    state.round >= state.totalRounds &&
    (state.phase === "answering" || state.phase === "voting");

  return (
    <main className="screen host">
      <TopBar />
      <ReactionOverlay />
      {/* Players already get this; without it the TV froze mid-game with no
          explanation while everyone stared at it. */}
      {!connected && (
        <div className="reconnect-overlay" role="alert">
          <div className="badge warn">{t("reconnecting")}</div>
        </div>
      )}
      {confirming && (
        <ConfirmDialog
          message={t(confirming === "end" ? "endGameConfirm" : "leaveConfirm")}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            if (confirming === "end") void endGame();
            else leaveGame();
          }}
        />
      )}
      <header className="host-header">
        <div className="logo small">
          <span className="logo-q">M</span>atah
        </div>
        <div className="room-code-pill">
          {t("roomCode")}: <bdi>{state.code || code}</bdi>
          <CopyCodeButton code={state.code || code} />
        </div>
        {state.round > 0 && state.phase !== "gameover" && (
          <div className="round-pill">
            {t("round", { n: state.round, total: state.totalRounds })}
          </div>
        )}
        {state.audience.length > 0 && (
          <div className="audience-pill">
            {t("audienceCount", { n: state.audience.length })}
          </div>
        )}
        <div className="host-header-spacer" />
        {secondsLeft !== null && (
          <div
            className={`timer ${secondsLeft <= 5 ? "danger" : ""}`}
            role="timer"
            aria-label={t("secondsLeft", { n: secondsLeft })}
          >
            {secondsLeft}
          </div>
        )}
        {(state.phase === "answering" ||
          state.phase === "voting" ||
          state.phase === "results") && (
          <button className="btn ghost end-game-btn" onClick={() => setConfirming("end")} disabled={pending !== null}>
            {t("endGame")}
          </button>
        )}
        <button className="btn link host-leave" onClick={askLeave} disabled={leaving || pending !== null}>
          {t("leaveRoom")}
        </button>
      </header>

      {commandError && (
        <div className="badge error command-error" role="alert">
          {commandError}
        </div>
      )}

      {isFinalRound && (
        <div className="final-banner pop-in">
          {state.gameType === "trivia" ? t("finalQuestion") : t("finalRound")}
        </div>
      )}

      {state.phase === "lobby" && (
        <LobbyView
          state={state}
          pending={pending !== null}
          onStart={start}
          onKick={kick}
          onLanguage={setGameLanguage}
        />
      )}

      {state.phase === "answering" && state.gameType === "quiplash" && (
        <div className="host-body center" key="answering">
          <h2 className="phase-title">{t("writingAnswers")}</h2>
          <p className="hint">{t("answerHint")}</p>
          <PlayerChips state={state} flag="hasSubmitted" />
        </div>
      )}

      {state.phase === "answering" && state.gameType === "trivia" && (
        <TriviaQuestionView state={state} />
      )}

      {state.phase === "voting" && state.quiplash?.activeMatchup && (
        <QuiplashVoteView state={state} />
      )}

      {state.phase === "results" && state.gameType === "quiplash" && (
        <QuiplashResultsView state={state} onNext={next} pending={pending !== null} />
      )}

      {state.phase === "results" && state.gameType === "trivia" && (
        <TriviaResultsView state={state} />
      )}

      {(state.phase === "scoreboard" || state.phase === "gameover") && (
        <ScoreboardView
          state={state}
          pending={pending !== null || leaving}
          onRematch={() => runCommand("rematch", () => emitAck<null>("game:rematch", { phaseId: state.phaseId }))}
          onChangeSettings={() => runCommand("restart", () => emitAck<null>("game:restart", { phaseId: state.phaseId }))}
          onLeave={onLeave}
        />
      )}
    </main>
  );
}

function CopyCodeButton({ code }: { code: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      playSfx("click");
      resetTimer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable (http / old browser) — button is best-effort */
    }
  };
  return (
    <button className="copy-btn" onClick={copy} aria-label={copied ? t("copied") : t("copyCode")}>
      {copied ? <IconCheck /> : <IconCopy />}
    </button>
  );
}

/** QR code that deep-links phones straight into the join form. */
function JoinQr({ code }: { code: string }) {
  const { t } = useI18n();
  // "" is still loading, null is a failure, a data URL is the code.
  const [src, setSrc] = useState<string | null>("");

  useEffect(() => {
    let cancelled = false;
    const url = `${window.location.origin}/?code=${code}`;
    void import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(url, {
          margin: 1,
          width: 220,
          color: { dark: "#14110c", light: "#f8f1e2" },
        })
      )
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Reserve the space immediately: the lobby used to reflow when the lazily
  // imported encoder landed, and a failure was indistinguishable from loading.
  if (src === null) {
    return (
      <div className="qr-box qr-failed">
        <span className="qr-hint">{t("qrUnavailable")}</span>
      </div>
    );
  }
  if (src === "") {
    return <div className="qr-box qr-skeleton" aria-hidden="true" />;
  }
  return (
    <div className="qr-box pop-in">
      <img src={src} alt={t("scanToJoin")} />
      <span className="qr-hint">{t("scanToJoin")}</span>
    </div>
  );
}

function PlayerChips({
  state,
  flag,
}: {
  state: RoomState;
  flag: "hasSubmitted" | "hasVoted";
}) {
  return (
    <div className="player-chips">
      {state.players.map((p) => (
        <span key={p.id} className={`chip ${p[flag] ? "done" : "pending"}`}>
          {p[flag] ? <IconCheck className="chip-tick" /> : <span className="chip-wait" />}
          <Avatar id={p.avatar} /> {p.name}
        </span>
      ))}
    </div>
  );
}

function LobbyView({
  state,
  pending,
  onStart,
  onKick,
  onLanguage,
}: {
  state: RoomState;
  pending: boolean;
  onStart: (g: GameType, rounds: number) => void;
  onKick: (playerId: string) => void;
  onLanguage: (language: Language) => void;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<GameType>("quiplash");
  // Length bounds & default depend on the selected mode (rounds vs questions).
  const bounds =
    selected === "trivia"
      ? { min: MIN_QUESTIONS, max: MAX_QUESTIONS, def: TRIVIA_QUESTIONS }
      : { min: MIN_ROUNDS, max: MAX_ROUNDS, def: DEFAULT_TOTAL_ROUNDS };
  const [length, setLength] = useState(bounds.def);
  const enough = state.players.length >= MIN_PLAYERS;

  const pickMode = (g: GameType) => {
    setSelected(g);
    setLength(
      g === "trivia" ? TRIVIA_QUESTIONS : DEFAULT_TOTAL_ROUNDS
    );
  };
  const clampedLength = Math.min(bounds.max, Math.max(bounds.min, length));

  return (
    <div className="host-body center" key="lobby">
      <h1 className="join-instructions">
        {t("joinInstructions")}{" "}
        <b className="code-hl">{state.code}</b>
      </h1>

      <JoinQr code={state.code} />

      <label className="content-language">
        <span>{t("gameLanguage")}</span>
        <select
          className="input"
          value={state.language}
          disabled={pending}
          onChange={(event) => onLanguage(event.target.value as Language)}
        >
          {LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {LANGUAGE_LABELS[language]}
            </option>
          ))}
        </select>
      </label>

      <div className="lobby-players">
        {state.players.length === 0 && (
          <p className="hint">{t("waitingPlayers")}</p>
        )}
        {state.players.map((p) => (
          <div
            key={p.id}
            className={`lobby-player ${!p.connected ? "off" : ""}`}
          >
            <Avatar id={p.avatar} className="lobby-avatar" /> {p.name}
            <button
              className="kick-btn"
              onClick={() => onKick(p.id)}
              disabled={pending}
              aria-label={t("kickAria", { name: p.name })}
              title={t("kickAria", { name: p.name })}
            >
              <IconClose />
            </button>
          </div>
        ))}
      </div>

      <div className="game-picker">
        <GameCard
          active={selected === "quiplash"}
          icon={<QuiplashIcon />}
          title={t("gameQuiplash")}
          desc={t("gameQuiplashDesc")}
          onClick={() => pickMode("quiplash")}
        />
        <GameCard
          active={selected === "trivia"}
          icon={<TriviaIcon />}
          title={t("gameTrivia")}
          desc={t("gameTriviaDesc")}
          onClick={() => pickMode("trivia")}
        />
      </div>

      <div className="length-picker" role="group" aria-label={t(selected === "trivia" ? "questionsLabel" : "roundsLabel")}>
        <span className="length-label">
          {t(selected === "trivia" ? "questionsLabel" : "roundsLabel")}
        </span>
        <button
          className="length-step"
          onClick={() => setLength((n) => Math.max(bounds.min, n - 1))}
          disabled={clampedLength <= bounds.min}
          aria-label={t("stepRoundsDown")}
        >
          −
        </button>
        <span className="length-value">{clampedLength}</span>
        <button
          className="length-step"
          onClick={() => setLength((n) => Math.min(bounds.max, n + 1))}
          disabled={clampedLength >= bounds.max}
          aria-label={t("stepRoundsUp")}
        >
          +
        </button>
      </div>

      <button
        className="btn primary big"
        onClick={() => onStart(selected, clampedLength)}
        disabled={!enough || pending}
      >
        {enough
          ? t("startGame", { n: state.players.length })
          : t("needPlayers", { min: MIN_PLAYERS })}
      </button>
    </div>
  );
}

function GameCard({
  active,
  icon,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`game-card ${active ? "active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className="game-icon">{icon}</span>
      <span className="game-title">{title}</span>
      <span className="game-desc">{desc}</span>
    </button>
  );
}

function QuiplashVoteView({ state }: { state: RoomState }) {
  const { t } = useI18n();
  const view = state.quiplash;
  const m = view?.activeMatchup;
  if (!m) {
    // Between matchups the server has no active pair; the room used to stare
    // at a blank screen here.
    return (
      <div className="host-body center">
        <h2 className="phase-title">{t("nextMatchup")}</h2>
        <div className="pulse-dot" />
      </div>
    );
  }
  return (
    <div className="host-body center" key={m.id}>
      <div className="vs-badge">
        {t("matchup", {
          n: view.currentMatchupIndex + 1,
          total: view.totalMatchups,
        })}
      </div>
      <h2 className="prompt-big">{m.prompt}</h2>
      <p className="hint">{t("voteOnPhone")}</p>
      <div className="vs-grid">
        {m.answers.map((a, i) => (
          <div key={a.answerId} className={`vs-card c${i} pop-in`}>
            <span className="vs-text">{a.text}</span>
          </div>
        ))}
      </div>
      <VoteProgress state={state} authorCount={m.answers.length} />
    </div>
  );
}

/**
 * Live vote tally for the host screen.
 *
 * The room used to sit through twenty silent seconds with nothing changing.
 * Authorship stays hidden during voting, so the eligible total is derived:
 * every connected participant except the matchup's authors, of whom there are
 * exactly as many as there are answers.
 */
function VoteProgress({
  state,
  authorCount,
}: {
  state: RoomState;
  authorCount: number;
}) {
  const { t } = useI18n();
  const participants = [...state.players, ...state.audience].filter((p) => p.connected);
  const voted = participants.filter((p) => p.hasVoted).length;
  const eligible = Math.max(voted, participants.length - authorCount);
  if (eligible === 0) return null;
  return (
    <div className="vote-progress" role="status" aria-live="polite">
      <div className="vote-progress-bar">
        <span style={{ width: `${(voted / eligible) * 100}%` }} />
      </div>
      <span className="vote-progress-label">
        {t("votingProgress", { n: voted, total: eligible })}
      </span>
    </div>
  );
}

function QuiplashResultsView({
  state,
  onNext,
  pending,
}: {
  state: RoomState;
  onNext: () => void;
  pending: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="host-body" key="qresults">
      <h2 className="phase-title center">
        {t("roundResults", { n: state.round })}
      </h2>
      {state.round > 1 && (
        <p className="round-multiplier center">
          {t("roundMultiplier", { n: state.round })}
        </p>
      )}
      <div className="results-list">
        {(state.quiplash?.lastResults ?? []).map((r, i) => {
          // On a tie every top answer gets the winner highlight.
          const maxVotes = Math.max(...r.answers.map((a) => a.votes));
          return (
            <div
              key={i}
              className="result-row pop-in"
              // Reveal one row at a time: the whole board landing at once gave
              // the room nothing to react to.
              style={{ animationDelay: `${i * 0.12}s` }}
            >
              <div className="result-prompt">{r.prompt}</div>
              <div className="result-answers">
                {r.answers.map((a) => (
                  <div
                    key={a.playerId}
                    className={`result-answer ${
                      a.votes === maxVotes && a.votes > 0 ? "win" : ""
                    }`}
                  >
                    <span className="ra-text">{a.text}</span>
                    <span className="ra-meta">
                      {a.playerName} · {a.votes} {t("voteUnit")} · +
                      {a.pointsAwarded}
                      {a.submitBonus > 0 && (
                        // Show the participation reward separately, or the
                        // scoreboard looks arbitrary.
                        <span className="ra-bonus">
                          {" "}
                          +{a.submitBonus} {t("bonusLabel")}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="center">
        <button className="btn ghost" onClick={onNext} disabled={pending}>
          {t("continueBtn")}
        </button>
      </div>
    </div>
  );
}

function TriviaQuestionView({ state }: { state: RoomState }) {
  const { t } = useI18n();
  const q = state.trivia?.question;
  if (!q) return null;
  return (
    <div className="host-body center" key={q.id}>
      <div className="vs-badge">
        {t("triviaQuestion", {
          n: (state.trivia?.questionIndex ?? 0) + 1,
          total: state.trivia?.totalQuestions ?? 0,
        })}
      </div>
      <h2 className="prompt-big">{q.text}</h2>
      <div className="trivia-options host">
        {q.options.map((opt, i) => (
          <div key={i} className={`trivia-opt o${i} pop-in`}>
            <span className="opt-letter">{OPTION_LETTERS[i]}</span>
            <span className="opt-text">{opt}</span>
          </div>
        ))}
      </div>
      <p className="hint">{t("triviaPick")}</p>
      <PlayerChips state={state} flag="hasSubmitted" />
    </div>
  );
}

function TriviaResultsView({ state }: { state: RoomState }) {
  const { t } = useI18n();
  const q = state.trivia?.question;
  const reveal = state.trivia?.reveal;
  if (!q || !reveal) return null;
  return (
    <div className="host-body center" key={`r-${q.id}`}>
      <h2 className="phase-title">{t("triviaCorrect")}</h2>
      <div className="trivia-options host">
        {q.options.map((opt, i) => (
          <div
            key={i}
            className={`trivia-opt o${i} ${
              i === reveal.correctIndex ? "correct" : "dim"
            }`}
          >
            <span className="opt-letter">{OPTION_LETTERS[i]}</span>
            <span className="opt-text">{opt}</span>
            <span className="opt-count">{reveal.counts[i]}</span>
          </div>
        ))}
      </div>
      <div className="round-points">
        {reveal.pointsThisRound
          .filter((p) => p.points > 0)
          .map((p) => (
            <span key={p.playerId} className="chip done">
              {p.playerName} +{p.points}
            </span>
          ))}
      </div>
    </div>
  );
}

function ScoreboardView({
  state,
  pending,
  onRematch,
  onChangeSettings,
  onLeave,
}: {
  state: RoomState;
  pending: boolean;
  onRematch: () => void;
  onChangeSettings: () => void;
  onLeave: () => Promise<void>;
}) {
  const { t } = useI18n();
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  return (
    <div className="host-body center" key="scoreboard">
      <Confetti />
      <h1 className="phase-title bounce-in">
        <PartyIcon /> {t("gameOver")}
      </h1>
      <div className="scoreboard">
        {ranked.map((p, i) => (
          <div
            key={p.id}
            className={`score-row rank-${i} pop-in`}
            style={{ animationDelay: `${i * 0.12}s` }}
          >
            <span className="score-rank">
              {i < 3 ? <Medal rank={i} /> : `${i + 1}.`}
            </span>
            <span className="score-name">
              <Avatar id={p.avatar} /> {p.name}
            </span>
            <span className="score-pts">{p.score}</span>
          </div>
        ))}
      </div>
      <div className="scoreboard-actions">
        <button
          className="btn primary"
          onClick={onRematch}
          disabled={pending}
        >
          {t("playAgain")}
        </button>
        <button className="btn ghost" onClick={onChangeSettings} disabled={pending}>
          {t("backToMenu")}
        </button>
        <button className="btn link" onClick={() => void onLeave()} disabled={pending}>
          {t("leaveRoom")}
        </button>
      </div>
    </div>
  );
}
