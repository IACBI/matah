import { useEffect, useRef, useState } from "react";
import type { GamePhase, GameType, RoomState } from "../../../shared/src/index";
import { MIN_PLAYERS } from "../../../shared/src/index";
import { emitAck } from "../socket";
import { useI18n } from "../i18n";
import { TopBar } from "../components/Controls";
import { Confetti } from "../components/Confetti";
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
  const start = (gameType: GameType) => {
    playSfx("submit");
    emitAck("game:start", { gameType });
  };
  const next = () => {
    playSfx("click");
    emitAck("game:next");
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
      </div>
    );
  }

  return (
    <div className="screen host">
      <TopBar />
      <header className="host-header">
        <div className="logo small">
          <span className="logo-q">Q</span>uibble
        </div>
        <div className="room-code-pill">
          {t("roomCode")}: <b>{state.code || code}</b>
        </div>
        {state.round > 0 && state.phase !== "gameover" && (
          <div className="round-pill">
            {t("round", { n: state.round, total: state.totalRounds })}
          </div>
        )}
        {state.timer !== null && (
          <div className={`timer ${state.timer <= 5 ? "danger" : ""}`}>
            {state.timer}
          </div>
        )}
      </header>

      {state.phase === "lobby" && <LobbyView state={state} onStart={start} />}

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
          {p.name}
        </span>
      ))}
    </div>
  );
}

function LobbyView({
  state,
  onStart,
}: {
  state: RoomState;
  onStart: (g: GameType) => void;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<GameType>("quiplash");
  const enough = state.players.length >= MIN_PLAYERS;

  return (
    <div className="host-body center" key="lobby">
      <h1 className="join-instructions">
        {t("joinInstructions")}{" "}
        <b className="code-hl">{state.code}</b>
      </h1>

      <div className="lobby-players">
        {state.players.length === 0 && (
          <p className="hint">{t("waitingPlayers")}</p>
        )}
        {state.players.map((p) => (
          <div
            key={p.id}
            className={`lobby-player ${!p.connected ? "off" : ""}`}
          >
            {p.name}
          </div>
        ))}
      </div>

      <div className="game-picker">
        <GameCard
          active={selected === "quiplash"}
          icon="✍️"
          title={t("gameQuiplash")}
          desc={t("gameQuiplashDesc")}
          onClick={() => setSelected("quiplash")}
        />
        <GameCard
          active={selected === "trivia"}
          icon="🧠"
          title={t("gameTrivia")}
          desc={t("gameTriviaDesc")}
          onClick={() => setSelected("trivia")}
        />
      </div>

      <button
        className="btn primary big"
        onClick={() => onStart(selected)}
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
  icon: string;
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
          const winner = [...r.answers].sort((a, b) => b.votes - a.votes)[0];
          return (
            <div key={i} className="result-row pop-in">
              <div className="result-prompt">{r.prompt}</div>
              <div className="result-answers">
                {r.answers.map((a) => (
                  <div
                    key={a.playerId}
                    className={`result-answer ${
                      a.playerId === winner.playerId && a.votes > 0 ? "win" : ""
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
            <span className="score-name">{p.name}</span>
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
