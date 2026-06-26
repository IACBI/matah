import { useEffect, useRef, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import type { GamePhase, GameType, RoomState } from "../../../shared/src/index";
import {
  DEFAULT_TOTAL_ROUNDS,
  MAX_QUESTIONS,
  MAX_ROUNDS,
  MIN_PLAYERS,
  MIN_QUESTIONS,
  MIN_ROUNDS,
  TRIVIA_QUESTIONS,
} from "../../../shared/src/index";
import { emitAck } from "../socket";
import { useI18n } from "../i18n";
import { TopBar } from "../components/Controls";
import { Confetti } from "../components/Confetti";
import { ReactionOverlay } from "../components/Reactions";
import { QuiplashIcon, TriviaIcon } from "../components/GameIcons";
import { playSfx } from "../sound";

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

interface Props {
  code: string;
  state: RoomState | null;
  connected: boolean;
  onLeave: () => void;
}

export function HostScreen({ code, state, connected, onLeave }: Props) {
  const { t } = useI18n();
  const start = (gameType: GameType, rounds: number) => {
    playSfx("submit");
    emitAck("game:start", { gameType, rounds });
  };
  const next = () => {
    playSfx("click");
    emitAck("game:next");
  };
  const kick = (playerId: string) => {
    playSfx("click");
    void emitAck("player:kick", { playerId });
  };
  const endGame = () => {
    if (!window.confirm(t("endGameConfirm"))) return;
    playSfx("click");
    void emitAck("game:end");
  };
  const leaveGame = () => {
    const inProgress =
      !!state &&
      state.phase !== "lobby" &&
      state.phase !== "gameover" &&
      state.phase !== "scoreboard";
    if (inProgress && !window.confirm(t("leaveConfirm"))) return;
    playSfx("click");
    onLeave();
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
        <button className="btn link host-leave-center" onClick={onLeave}>
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
    <div className="screen host">
      <TopBar />
      <ReactionOverlay />
      <header className="host-header">
        <div className="logo small">
          <span className="logo-q">M</span>atah
        </div>
        <div className="room-code-pill">
          {t("roomCode")}: <b>{state.code || code}</b>
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
        {state.timer !== null && (
          <div className={`timer ${state.timer <= 5 ? "danger" : ""}`}>
            {state.timer}
          </div>
        )}
        {(state.phase === "answering" ||
          state.phase === "voting" ||
          state.phase === "results") && (
          <button className="btn ghost end-game-btn" onClick={endGame}>
            {t("endGame")}
          </button>
        )}
        <button className="btn link host-leave" onClick={leaveGame}>
          {t("leaveRoom")}
        </button>
      </header>

      {isFinalRound && (
        <div className="final-banner pop-in">
          {state.gameType === "trivia" ? t("finalQuestion") : t("finalRound")}
        </div>
      )}

      {state.phase === "lobby" && (
        <LobbyView state={state} onStart={start} onKick={kick} />
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
        <QuiplashResultsView state={state} onNext={next} />
      )}

      {state.phase === "results" && state.gameType === "trivia" && (
        <TriviaResultsView state={state} />
      )}

      {(state.phase === "scoreboard" || state.phase === "gameover") && (
        <ScoreboardView state={state} onLeave={onLeave} />
      )}
    </div>
  );
}

function CopyCodeButton({ code }: { code: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      playSfx("click");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable (http / old browser) — button is best-effort */
    }
  };
  return (
    <button className="copy-btn" onClick={copy} aria-label={t("copyCode")}>
      {copied ? t("copied") : "📋"}
    </button>
  );
}

/** QR code that deep-links phones straight into the join form. */
function JoinQr({ code }: { code: string }) {
  const { t } = useI18n();
  const [src, setSrc] = useState<string>("");

  useEffect(() => {
    const url = `${window.location.origin}/?code=${code}`;
    QRCode.toDataURL(url, {
      margin: 1,
      width: 220,
      color: { dark: "#14110c", light: "#f8f1e2" },
    })
      .then(setSrc)
      .catch(() => setSrc(""));
  }, [code]);

  if (!src) return null;
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
          {p[flag] ? "✓ " : "… "}
          {p.avatar} {p.name}
        </span>
      ))}
    </div>
  );
}

function LobbyView({
  state,
  onStart,
  onKick,
}: {
  state: RoomState;
  onStart: (g: GameType, rounds: number) => void;
  onKick: (playerId: string) => void;
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

      <div className="lobby-players">
        {state.players.length === 0 && (
          <p className="hint">{t("waitingPlayers")}</p>
        )}
        {state.players.map((p) => (
          <div
            key={p.id}
            className={`lobby-player ${!p.connected ? "off" : ""}`}
          >
            <span className="lobby-avatar">{p.avatar}</span> {p.name}
            <button
              className="kick-btn"
              onClick={() => onKick(p.id)}
              aria-label={t("kickAria", { name: p.name })}
              title={t("kickAria", { name: p.name })}
            >
              ✕
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
          aria-label="−"
        >
          −
        </button>
        <span className="length-value">{clampedLength}</span>
        <button
          className="length-step"
          onClick={() => setLength((n) => Math.min(bounds.max, n + 1))}
          disabled={clampedLength >= bounds.max}
          aria-label="+"
        >
          +
        </button>
      </div>

      <button
        className="btn primary big"
        onClick={() => onStart(selected, clampedLength)}
        disabled={!enough}
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
    <button className={`game-card ${active ? "active" : ""}`} onClick={onClick}>
      <span className="game-icon">{icon}</span>
      <span className="game-title">{title}</span>
      <span className="game-desc">{desc}</span>
    </button>
  );
}

function QuiplashVoteView({ state }: { state: RoomState }) {
  const { t } = useI18n();
  const m = state.quiplash!.activeMatchup!;
  return (
    <div className="host-body center" key={m.id}>
      <div className="vs-badge">
        {t("matchup", {
          n: state.quiplash!.currentMatchupIndex + 1,
          total: state.quiplash!.totalMatchups,
        })}
      </div>
      <h2 className="prompt-big">{m.prompt}</h2>
      <p className="hint">{t("voteOnPhone")}</p>
      <div className="vs-grid">
        {m.answers.map((a, i) => (
          <div key={a.playerId} className={`vs-card c${i} pop-in`}>
            <span className="vs-text">{a.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuiplashResultsView({
  state,
  onNext,
}: {
  state: RoomState;
  onNext: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="host-body" key="qresults">
      <h2 className="phase-title center">
        {t("roundResults", { n: state.round })}
      </h2>
      <div className="results-list">
        {state.quiplash!.lastResults!.map((r, i) => {
          // On a tie every top answer gets the winner highlight.
          const maxVotes = Math.max(...r.answers.map((a) => a.votes));
          return (
            <div key={i} className="result-row pop-in">
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
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="center">
        <button className="btn ghost" onClick={onNext}>
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
          n: state.trivia!.questionIndex + 1,
          total: state.trivia!.totalQuestions,
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
  onLeave,
}: {
  state: RoomState;
  onLeave: () => void;
}) {
  const { t } = useI18n();
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <div className="host-body center" key="scoreboard">
      <Confetti />
      <h1 className="phase-title bounce-in">{t("gameOver")}</h1>
      <div className="scoreboard">
        {ranked.map((p, i) => (
          <div
            key={p.id}
            className={`score-row rank-${i} pop-in`}
            style={{ animationDelay: `${i * 0.12}s` }}
          >
            <span className="score-rank">{medals[i] ?? `${i + 1}.`}</span>
            <span className="score-name">
              {p.avatar} {p.name}
            </span>
            <span className="score-pts">{p.score}</span>
          </div>
        ))}
      </div>
      <div className="scoreboard-actions">
        <button
          className="btn primary"
          onClick={() => {
            playSfx("submit");
            emitAck("game:restart");
          }}
        >
          {t("playAgain")}
        </button>
        <button className="btn ghost" onClick={onLeave}>
          {t("backToMenu")}
        </button>
      </div>
    </div>
  );
}
