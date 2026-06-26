import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerAssignment, RoomState } from "../../../shared/src/index";
import { emitAck } from "../socket";
import { useI18n } from "../i18n";
import { errorKey } from "../i18n/translations";
import { TopBar } from "../components/Controls";
import { ReactionBar } from "../components/Reactions";
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
  const audienceMe = state?.audience.find((a) => a.id === myPlayerId);
  const isAudience = !me && !!audienceMe;

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

  // Audience can react during voting too; players only after the action phases.
  const showReactions =
    state.phase === "results" ||
    state.phase === "scoreboard" ||
    state.phase === "gameover" ||
    (state.phase === "voting" && isAudience);

  return (
    <div className="screen player">
      {!connected && (
        <div className="reconnect-overlay" role="alert">
          <div className="badge warn">{t("reconnecting")}</div>
        </div>
      )}
      <header className="player-header">
        <span className="player-name">
          <span className="player-avatar">{me?.avatar ?? audienceMe?.avatar}</span>{" "}
          {me?.name ?? audienceMe?.name ?? t("you")}
        </span>
        <span className="player-stats">
          {isAudience && <span className="badge aud">{t("audienceBadge")}</span>}
          {me && me.streak > 1 && (
            <span className="streak">{t("streak", { n: me.streak })}</span>
          )}
          {!isAudience && (
            <span className="player-score">
              {me?.score ?? 0} {t("points")}
            </span>
          )}
          {state.timer !== null && (
            <span
              className={`player-timer ${state.timer <= 5 ? "danger" : ""}`}
              aria-live="off"
            >
              ⏱ {state.timer}
            </span>
          )}
        </span>
      </header>

      {state.phase === "lobby" && (
        <div className="player-body center fade-in">
          <h2>{t("ready")}</h2>
          <p className="hint">{t("waitingStart")}</p>
          <div className="pulse-dot" />
        </div>
      )}

      {state.phase === "answering" &&
        (isAudience ? (
          <AudienceWaitView />
        ) : state.gameType === "quiplash" ? (
          <AnsweringView
            assignment={assignment}
            submitted={me?.hasSubmitted}
            timer={state.timer}
          />
        ) : (
          <TriviaAnswerView state={state} submitted={me?.hasSubmitted} />
        ))}

      {state.phase === "voting" && (
        <VotingView state={state} myPlayerId={myPlayerId} />
      )}

      {state.phase === "results" &&
        state.gameType === "trivia" &&
        (isAudience ? (
          <AudienceWaitView />
        ) : (
          <TriviaPlayerResult state={state} myPlayerId={myPlayerId} />
        ))}

      {state.phase === "results" && state.gameType === "quiplash" && (
        <div className="player-body center fade-in">
          <h2>{t("resultsOnScreen")}</h2>
          <p className="hint">{t("lookAtTv")}</p>
        </div>
      )}

      {(state.phase === "scoreboard" || state.phase === "gameover") && (
        <div className="player-body center fade-in">
          <h2>{t("gameOver")}</h2>
          {!isAudience && (
            <>
              <p className="big-score bounce-in">{me?.score ?? 0}</p>
              <p className="hint">{t("youScored")}</p>
            </>
          )}
          {state.phase === "gameover" && !state.hostConnected && !isAudience && (
            <>
              <p className="hint">{t("hostGone")}</p>
              <button
                className="btn primary"
                onClick={() => {
                  playSfx("submit");
                  void emitAck("game:restart");
                }}
              >
                {t("playAgain")}
              </button>
            </>
          )}
          <button className="btn ghost" onClick={onLeave}>
            {t("exit")}
          </button>
        </div>
      )}

      {showReactions && <ReactionBar />}
    </div>
  );
}

function AudienceWaitView() {
  const { t } = useI18n();
  return (
    <div className="player-body center fade-in">
      <h2>{t("enjoyShow")}</h2>
      <p className="hint">{t("audienceWaitHint")}</p>
      <div className="pulse-dot" />
    </div>
  );
}

function AnsweringView({
  assignment,
  submitted,
  timer,
}: {
  assignment: PlayerAssignment | null;
  submitted?: boolean;
  timer?: number | null;
}) {
  const { t } = useI18n();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<Record<string, boolean>>({});
  // Per-matchup in-flight flag so sending one prompt doesn't lock the other.
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const answersRef = useRef(answers);
  answersRef.current = answers;
  // Tracks matchups currently being submitted, to dedupe a manual click racing
  // the timer's auto-submit (refs update synchronously, unlike state).
  const inFlight = useRef<Set<string>>(new Set());
  const sentRef = useRef(sent);
  sentRef.current = sent;

  const send = useCallback(
    async (matchupId: string) => {
      const text = answersRef.current[matchupId]?.trim();
      if (!text || sentRef.current[matchupId] || inFlight.current.has(matchupId))
        return;
      inFlight.current.add(matchupId);
      setSending((s) => ({ ...s, [matchupId]: true }));
      setError("");
      const res = await emitAck("answer:submit", { matchupId, text });
      inFlight.current.delete(matchupId);
      setSending((s) => ({ ...s, [matchupId]: false }));
      if (res.ok) {
        playSfx("submit");
        setSent((s) => ({ ...s, [matchupId]: true }));
      } else {
        setError(t(errorKey(res.error ?? "submit_failed")));
      }
    },
    [t]
  );

  // When the answering clock is almost out, auto-submit any typed-but-unsent
  // drafts so the player's words aren't replaced by a canned safety quip.
  useEffect(() => {
    if (timer === null || timer === undefined || timer > 2 || !assignment) return;
    for (const p of assignment.prompts) {
      if (!sentRef.current[p.matchupId] && answersRef.current[p.matchupId]?.trim()) {
        void send(p.matchupId);
      }
    }
  }, [timer, assignment, send]);

  if (!assignment) {
    return (
      <div className="player-body center">
        <div className="badge warn">…</div>
      </div>
    );
  }

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
                disabled={sending[p.matchupId] || !answers[p.matchupId]?.trim()}
              >
                {t("send")}
              </button>
            </>
          )}
        </div>
      ))}
      {error && <div className="badge error shake">{error}</div>}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setVoted(null);
    setBusy(false);
    setError("");
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
    if (busy) return;
    setBusy(true);
    setError("");
    const res = await emitAck("vote:submit", {
      matchupId: matchup.id,
      answerPlayerId,
    });
    setBusy(false);
    if (res.ok) {
      playSfx("vote");
      setVoted(answerPlayerId);
    } else {
      setError(t(errorKey(res.error ?? "vote_failed")));
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
            disabled={busy}
            aria-label={t("ariaVote", { text: a.text })}
          >
            {a.text}
          </button>
        ))}
      </div>
      {error && <div className="badge error shake">{error}</div>}
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
  const [error, setError] = useState("");

  useEffect(() => {
    setPicked(null);
    setError("");
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
    setError("");
    const res = await emitAck("trivia:answer", {
      questionId: q.id,
      optionIndex,
    });
    if (res.ok) playSfx("submit");
    else {
      setPicked(null);
      setError(t(errorKey(res.error ?? "submit_failed")));
    }
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
            aria-label={t("ariaOption", { letter: OPTION_LETTERS[i], text: opt })}
          >
            <span className="opt-letter">{OPTION_LETTERS[i]}</span>
            <span className="opt-text">{opt}</span>
          </button>
        ))}
      </div>
      {error && <div className="badge error shake">{error}</div>}
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
