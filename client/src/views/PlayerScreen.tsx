import { useEffect, useState } from "react";
import type { PlayerAssignment, RoomState } from "../../../shared/src/index";
import { emitAck } from "../socket";
import { useI18n } from "../i18n";
import { TopBar } from "../components/Controls";
import { playSfx } from "../sound";

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

interface Props {
  code: string;
  myPlayerId: string;
  state: RoomState | null;
  assignment: PlayerAssignment | null;
  connected: boolean;
  onLeave: () => void;
}

export function PlayerScreen({
  myPlayerId,
  state,
  assignment,
  connected,
  onLeave,
}: Props) {
  const { t } = useI18n();
  const me = state?.players.find((p) => p.id === myPlayerId);

  if (!state) {
    return (
      <div className="screen player center">
        <TopBar />
        <div className="badge warn">
          {connected ? t("joiningRoom") : t("connecting")}
        </div>
      </div>
    );
  }

  return (
    <div className="screen player">
      <header className="player-header">
        <span className="player-name">{me?.name ?? t("you")}</span>
        <span className="player-stats">
          {me && me.streak > 1 && (
            <span className="streak">{t("streak", { n: me.streak })}</span>
          )}
          <span className="player-score">
            {me?.score ?? 0} {t("points")}
          </span>
        </span>
      </header>

      {state.phase === "lobby" && (
        <div className="player-body center fade-in">
          <h2>{t("ready")}</h2>
          <p className="hint">{t("waitingStart")}</p>
          <div className="pulse-dot" />
        </div>
      )}

      {state.phase === "answering" && state.gameType === "quiplash" && (
        <AnsweringView assignment={assignment} submitted={me?.hasSubmitted} />
      )}

      {state.phase === "answering" && state.gameType === "trivia" && (
        <TriviaAnswerView state={state} submitted={me?.hasSubmitted} />
      )}

      {state.phase === "voting" && (
        <VotingView state={state} myPlayerId={myPlayerId} />
      )}

      {state.phase === "results" && state.gameType === "trivia" && (
        <TriviaPlayerResult state={state} myPlayerId={myPlayerId} />
      )}

      {state.phase === "results" && state.gameType === "quiplash" && (
        <div className="player-body center fade-in">
          <h2>{t("resultsOnScreen")}</h2>
          <p className="hint">{t("lookAtTv")}</p>
        </div>
      )}

      {(state.phase === "scoreboard" || state.phase === "gameover") && (
        <div className="player-body center fade-in">
          <h2>{t("gameOver")}</h2>
          <p className="big-score bounce-in">{me?.score ?? 0}</p>
          <p className="hint">{t("youScored")}</p>
          <button className="btn ghost" onClick={onLeave}>
            {t("exit")}
          </button>
        </div>
      )}
    </div>
  );
}

function AnsweringView({
  assignment,
  submitted,
}: {
  assignment: PlayerAssignment | null;
  submitted?: boolean;
}) {
  const { t } = useI18n();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<Record<string, boolean>>({});

  if (!assignment) {
    return (
      <div className="player-body center">
        <div className="badge warn">…</div>
      </div>
    );
  }

  const send = async (matchupId: string) => {
    const text = answers[matchupId]?.trim();
    if (!text) return;
    const res = await emitAck("answer:submit", { matchupId, text });
    if (res.ok) {
      playSfx("submit");
      setSent((s) => ({ ...s, [matchupId]: true }));
    }
  };

  const allSent =
    submitted || assignment.prompts.every((p) => sent[p.matchupId]);

  if (allSent) {
    return (
      <div className="player-body center fade-in">
        <h2>{t("sentWaiting")}</h2>
        <p className="hint">{t("waitingOthersAnswer")}</p>
        <div className="pulse-dot" />
      </div>
    );
  }

  return (
    <div className="player-body fade-in">
      <h2 className="answer-title">{t("writeFunny")}</h2>
      {assignment.prompts.map((p) => (
        <div key={p.matchupId} className="answer-block">
          <div className="answer-prompt">{p.prompt}</div>
          {sent[p.matchupId] ? (
            <div className="badge ok">{t("sent")}</div>
          ) : (
            <>
              <textarea
                className="input answer-input"
                placeholder={t("yourAnswer")}
                maxLength={120}
                value={answers[p.matchupId] ?? ""}
                onChange={(e) =>
                  setAnswers((a) => ({ ...a, [p.matchupId]: e.target.value }))
                }
              />
              <button
                className="btn primary"
                onClick={() => send(p.matchupId)}
                disabled={!answers[p.matchupId]?.trim()}
              >
                {t("send")}
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function VotingView({
  state,
  myPlayerId,
}: {
  state: RoomState;
  myPlayerId: string;
}) {
  const { t } = useI18n();
  const matchup = state.quiplash?.activeMatchup ?? null;
  const [voted, setVoted] = useState<string | null>(null);

  useEffect(() => {
    setVoted(null);
  }, [matchup?.id]);

  if (!matchup) {
    return (
      <div className="player-body center">
        <div className="badge warn">…</div>
      </div>
    );
  }

  const isAuthor = matchup.answers.some((a) => a.playerId === myPlayerId);

  if (isAuthor) {
    return (
      <div className="player-body center fade-in">
        <h2>{t("yourMatchup")}</h2>
        <p className="hint">{t("cantVoteOwn")}</p>
      </div>
    );
  }

  if (voted) {
    return (
      <div className="player-body center fade-in">
        <h2>{t("voteSaved")}</h2>
        <p className="hint">{t("waitingOthers")}</p>
      </div>
    );
  }

  const vote = async (answerPlayerId: string) => {
    const res = await emitAck("vote:submit", {
      matchupId: matchup.id,
      answerPlayerId,
    });
    if (res.ok) {
      playSfx("vote");
      setVoted(answerPlayerId);
    }
  };

  return (
    <div className="player-body fade-in">
      <div className="answer-prompt center">{matchup.prompt}</div>
      <p className="hint center">{t("voteWhichFunnier")}</p>
      <div className="vote-options">
        {matchup.answers.map((a, i) => (
          <button
            key={a.playerId}
            className={`vote-btn c${i}`}
            onClick={() => vote(a.playerId)}
          >
            {a.text}
          </button>
        ))}
      </div>
    </div>
  );
}

function TriviaAnswerView({
  state,
  submitted,
}: {
  state: RoomState;
  submitted?: boolean;
}) {
  const { t } = useI18n();
  const q = state.trivia?.question ?? null;
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    setPicked(null);
  }, [q?.id]);

  if (!q) {
    return (
      <div className="player-body center">
        <div className="badge warn">…</div>
      </div>
    );
  }

  if (submitted || picked !== null) {
    return (
      <div className="player-body center fade-in">
        <h2>{t("triviaLocked")}</h2>
        <p className="hint">{t("waitingOthers")}</p>
        <div className="pulse-dot" />
      </div>
    );
  }

  const answer = async (optionIndex: number) => {
    setPicked(optionIndex);
    const res = await emitAck("trivia:answer", {
      questionId: q.id,
      optionIndex,
    });
    if (res.ok) playSfx("submit");
    else setPicked(null);
  };

  return (
    <div className="player-body fade-in">
      <div className="answer-prompt center">{q.text}</div>
      <div className="trivia-options player">
        {q.options.map((opt, i) => (
          <button
            key={i}
            className={`trivia-opt o${i}`}
            onClick={() => answer(i)}
          >
            <span className="opt-letter">{OPTION_LETTERS[i]}</span>
            <span className="opt-text">{opt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TriviaPlayerResult({
  state,
  myPlayerId,
}: {
  state: RoomState;
  myPlayerId: string;
}) {
  const { t } = useI18n();
  const reveal = state.trivia?.reveal;
  const question = state.trivia?.question;
  // A correct trivia answer always scores > 0, a wrong/missed one scores 0.
  const mine = reveal?.pointsThisRound.find((p) => p.playerId === myPlayerId);
  const correct = (mine?.points ?? 0) > 0;

  useEffect(() => {
    if (reveal) playSfx(correct ? "correct" : "wrong");
  }, [reveal, correct]);

  if (!reveal) {
    return (
      <div className="player-body center fade-in">
        <h2>{t("resultsOnScreen")}</h2>
        <p className="hint">{t("lookAtTv")}</p>
      </div>
    );
  }

  return (
    <div className={`player-body center fade-in result-${correct ? "right" : "wrong"}`}>
      <div className="verdict-emoji bounce-in">{correct ? "🎉" : "😅"}</div>
      <h2>{correct ? t("triviaRight") : t("triviaWrong")}</h2>
      {correct ? (
        <p className="big-score bounce-in">+{mine?.points}</p>
      ) : (
        question && (
          <p className="hint">
            {t("triviaCorrect")}: <b>{question.options[reveal.correctIndex]}</b>
          </p>
        )
      )}
    </div>
  );
}
