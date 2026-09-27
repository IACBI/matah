import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerAssignment, RoomState } from "../../../shared/src/index";
import { MAX_ANSWER_LEN, MAX_LIE_LEN } from "../../../shared/src/index";
import { emitAck } from "../socket";
import { useI18n } from "../i18n";
import { errorKey } from "../i18n/translations";
import { TopBar } from "../components/Controls";
import { ReactionBar } from "../components/Reactions";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Avatar } from "../components/Avatar";
import { ShareButton } from "../components/Results";
import { IconBack, IconTimer, VerdictRight, VerdictWrong } from "../components/icons";
import { haptic, playSfx } from "../sound";

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
const DRAFT_PREFIX = "matah.drafts.";

function draftKey(code: string, playerId: string): string {
  return `${DRAFT_PREFIX}${code}.${playerId}`;
}

function readDrafts(code: string, playerId: string): Record<string, string> {
  try {
    const value = JSON.parse(sessionStorage.getItem(draftKey(code, playerId)) ?? "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeDrafts(
  code: string,
  playerId: string,
  drafts: Record<string, string>,
): void {
  try {
    if (Object.keys(drafts).length === 0) {
      sessionStorage.removeItem(draftKey(code, playerId));
    } else {
      sessionStorage.setItem(draftKey(code, playerId), JSON.stringify(drafts));
    }
  } catch {
    // Draft persistence is best-effort; in-memory typing remains available.
  }
}

interface Props {
  code: string;
  myPlayerId: string;
  state: RoomState | null;
  assignment: PlayerAssignment | null;
  secondsLeft: number | null;
  connected: boolean;
  leaving: boolean;
  onLeave: () => Promise<void>;
}

export function PlayerScreen({
  code,
  myPlayerId,
  state,
  assignment,
  secondsLeft,
  connected,
  leaving,
  onLeave,
}: Props) {
  const { t } = useI18n();
  const [controlPending, setControlPending] = useState(false);
  const [controlError, setControlError] = useState("");
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const me = state?.players.find((p) => p.id === myPlayerId);
  const audienceMe = state?.audience.find((a) => a.id === myPlayerId);
  const isAudience = !me && !!audienceMe;

  const phase = state?.phase;
  const gameType = state?.gameType;
  useEffect(() => {
    // Depend on the fields, not the whole state object: a fresh object arrives
    // on every broadcast, which made this clear storage dozens of times a round.
    if (phase && (phase !== "answering" || gameType !== "quiplash")) {
      writeDrafts(code, myPlayerId, {});
    }
  }, [code, myPlayerId, phase, gameType]);

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

  const leaveGame = () => {
    playSfx("click");
    void onLeave();
  };
  const askLeave = () => {
    const inProgress =
      state.phase !== "lobby" &&
      state.phase !== "gameover" &&
      state.phase !== "scoreboard";
    if (inProgress) setConfirmingLeave(true);
    else leaveGame();
  };

  const rematch = async () => {
    if (controlPending) return;
    setControlPending(true);
    setControlError("");
    const result = await emitAck<null>("game:rematch", {
      phaseId: state.phaseId,
    });
    setControlPending(false);
    if (result.ok) playSfx("submit");
    else setControlError(t(errorKey(result.error)));
  };

  return (
    <main className="screen player">
      <TopBar />
      {!connected && (
        <div className="reconnect-overlay" role="alert">
          <div className="badge warn">{t("reconnecting")}</div>
        </div>
      )}
      {connected && state.pausedRemainingMs !== null && (
        <div className="reconnect-overlay paused-overlay" role="status">
          <div className="badge warn">{t("pausedHint")}</div>
        </div>
      )}
      {confirmingLeave && (
        <ConfirmDialog
          message={t("leaveConfirm")}
          onCancel={() => setConfirmingLeave(false)}
          onConfirm={() => {
            setConfirmingLeave(false);
            leaveGame();
          }}
        />
      )}
      <header className="player-header">
        <button
          className="player-leave"
          onClick={askLeave}
          aria-label={t("leaveRoom")}
          title={t("leaveRoom")}
        >
          <IconBack />
        </button>
        <span className="player-name">
          <Avatar id={me?.avatar ?? audienceMe?.avatar ?? ""} className="player-avatar" />{" "}
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
          {secondsLeft !== null && (
            <span
              className={`player-timer ${secondsLeft <= 5 ? "danger" : ""}`}
              role="timer"
              aria-label={t("secondsLeft", { n: secondsLeft })}
            >
              <IconTimer /> {secondsLeft}
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
            timer={secondsLeft}
            code={code}
            playerId={myPlayerId}
          />
        ) : state.gameType === "bluff" ? (
          <BluffWriteView state={state} assignment={assignment} submitted={me?.hasSubmitted} />
        ) : (
          <TriviaAnswerView state={state} submitted={me?.hasSubmitted} />
        ))}

      {state.phase === "voting" && state.gameType === "quiplash" && (
        <VotingView state={state} assignment={assignment} myPlayerId={myPlayerId} />
      )}

      {state.phase === "voting" &&
        state.gameType === "bluff" &&
        (isAudience ? (
          <AudienceWaitView />
        ) : (
          <BluffPickView state={state} assignment={assignment} voted={me?.hasVoted} />
        ))}

      {state.phase === "results" &&
        state.gameType === "bluff" &&
        (isAudience ? (
          <div className="player-body center fade-in">
            <h2>{t("resultsOnScreen")}</h2>
            <p className="hint">{t("lookAtTv")}</p>
          </div>
        ) : (
          <BluffPlayerResult state={state} assignment={assignment} myPlayerId={myPlayerId} />
        ))}

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
              {state.gamesPlayed >= 2 && (
                <p className="hint session-total">
                  {t("sessionTotal", { n: me?.sessionScore ?? 0 })}
                </p>
              )}
            </>
          )}
          <ShareButton state={state} />
          {state.phase === "gameover" && state.controllerPlayerId === myPlayerId && !isAudience && (
            <>
              <p className="hint">{t("hostGone")}</p>
              <button
                className="btn primary"
                onClick={() => void rematch()}
                disabled={controlPending}
              >
                {t("playAgain")}
              </button>
            </>
          )}
          <button className="btn ghost" onClick={() => void onLeave()} disabled={leaving}>
            {t("exit")}
          </button>
          {controlError && (
            <div className="badge error" role="alert">
              {controlError}
            </div>
          )}
        </div>
      )}

      {showReactions && <ReactionBar />}
    </main>
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
  timer,
  code,
  playerId,
}: {
  assignment: PlayerAssignment | null;
  timer?: number | null;
  code: string;
  playerId: string;
}) {
  const { t } = useI18n();
  const [answers, setAnswers] = useState<Record<string, string>>(
    () => readDrafts(code, playerId),
  );
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
        haptic();
        setSent((s) => ({ ...s, [matchupId]: true }));
        setAnswers((current) => {
          const next = { ...current };
          delete next[matchupId];
          return next;
        });
      } else {
        setError(t(errorKey(res.error ?? "submit_failed")));
      }
    },
    [t]
  );

  useEffect(() => {
    if (!assignment) return;
    const activeIds = new Set(assignment.prompts.map((prompt) => prompt.matchupId));
    setSent(Object.fromEntries(
      assignment.prompts.map((prompt) => [prompt.matchupId, prompt.submitted]),
    ));
    setAnswers((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([matchupId]) => activeIds.has(matchupId))
      )
    );
  }, [assignment]);

  // Persist drafts as a side effect of the state settling. Writing inside the
  // setAnswers updater made the updater impure, so StrictMode wrote twice per
  // keystroke.
  useEffect(() => {
    writeDrafts(code, playerId, answers);
  }, [answers, code, playerId]);

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

  // Seeded from the assignment, which is re-sent on reconnect, so this
  // survives a dropped connection without the room state having to say who has
  // answered — during quiplash that would say whose answer is the canned one.
  const allSent = assignment.prompts.every((p) => sent[p.matchupId]);

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
                maxLength={MAX_ANSWER_LEN}
                value={answers[p.matchupId] ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  setAnswers((current) => ({ ...current, [p.matchupId]: value }));
                }}
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
      {error && <div className="badge error shake" role="alert">{error}</div>}
    </div>
  );
}

function VotingView({
  state,
  assignment,
  myPlayerId,
}: {
  state: RoomState;
  assignment: PlayerAssignment | null;
  myPlayerId: string;
}) {
  const { t } = useI18n();
  const matchup = state.quiplash?.activeMatchup ?? null;
  const [voted, setVoted] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The server already knows whether this vote landed. Without reading it, a
  // reconnect re-rendered the buttons and every tap came back "vote failed"
  // until the matchup moved on. Local state stays for instant feedback; this
  // is the recovery path. Players read it from their private assignment, since
  // publishing who has not voted would name the matchup's two authors while
  // their answers are still anonymous; audience members author nothing and
  // keep their public flag.
  const alreadyVoted =
    (matchup !== null && assignment?.votedMatchupId === matchup.id) ||
    (state.audience.find((a) => a.id === myPlayerId)?.hasVoted ?? false);

  useEffect(() => {
    setVoted(null);
    setChosen(null);
    setBusy(false);
    setError("");
  }, [matchup?.id]);

  if (!matchup) {
    return (
      <div className="player-body center fade-in">
        <h2>{t("tallyingVotes")}</h2>
        <div className="pulse-dot" />
      </div>
    );
  }

  const isAuthor = assignment?.prompts.some(
    (prompt) => prompt.matchupId === matchup.id
  );

  if (isAuthor) {
    return (
      <div className="player-body center fade-in">
        <h2>{t("yourMatchup")}</h2>
        <p className="hint">{t("cantVoteOwn")}</p>
      </div>
    );
  }

  if (voted || alreadyVoted) {
    return (
      <div className="player-body center fade-in">
        <h2>{t("voteSaved")}</h2>
        <p className="hint">{t("waitingOthers")}</p>
      </div>
    );
  }

  const vote = async (answerId: string) => {
    if (busy) return;
    // Mark the tapped answer immediately: waiting on the round trip before
    // showing anything made the tap feel like it had not registered.
    setChosen(answerId);
    setBusy(true);
    setError("");
    playSfx("vote");
    haptic();
    const res = await emitAck("vote:submit", {
      matchupId: matchup.id,
      answerId,
    });
    setBusy(false);
    if (res.ok) {
      setVoted(answerId);
    } else {
      setChosen(null);
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
            key={a.answerId}
            className={`vote-btn c${i} ${
              chosen === a.answerId ? "chosen" : chosen ? "dimmed" : ""
            }`}
            onClick={() => vote(a.answerId)}
            disabled={busy}
            aria-label={t("ariaVote", { text: a.text })}
          >
            {a.text}
          </button>
        ))}
      </div>
      {error && <div className="badge error shake" role="alert">{error}</div>}
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
      {error && <div className="badge error shake" role="alert">{error}</div>}
    </div>
  );
}

/** Bluff: write a lie good enough to fool the room. */
function BluffWriteView({
  state,
  assignment,
  submitted,
}: {
  state: RoomState;
  assignment: PlayerAssignment | null;
  submitted?: boolean;
}) {
  const { t } = useI18n();
  const q = state.bluff?.question ?? null;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setText("");
    setSent(false);
    setError("");
  }, [q?.id]);

  if (!q) {
    return (
      <div className="player-body center">
        <div className="badge warn">…</div>
      </div>
    );
  }

  const serverSays =
    assignment?.bluff?.questionId === q.id && assignment.bluff.submitted;
  if (sent || submitted || serverSays) {
    return (
      <div className="player-body center fade-in">
        <h2>{t("sentWaiting")}</h2>
        <p className="hint">{t("waitingOthersAnswer")}</p>
        <div className="pulse-dot" />
      </div>
    );
  }

  const send = async () => {
    const lie = text.trim();
    if (!lie || busy) return;
    setBusy(true);
    setError("");
    const res = await emitAck("bluff:lie", { questionId: q.id, text: lie });
    setBusy(false);
    if (res.ok) {
      playSfx("submit");
      haptic();
      setSent(true);
    } else {
      setError(t(errorKey(res.error)));
    }
  };

  return (
    <form
      className="player-body fade-in"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <h2 className="answer-title">{t("bluffWriteTitle")}</h2>
      <div className="answer-prompt">{q.text}</div>
      <input
        className="input answer-input"
        placeholder={t("yourLie")}
        aria-label={t("yourLie")}
        maxLength={MAX_LIE_LEN}
        value={text}
        autoComplete="off"
        enterKeyHint="send"
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" className="btn primary" disabled={busy || !text.trim()}>
        {t("send")}
      </button>
      {error && <div className="badge error shake" role="alert">{error}</div>}
    </form>
  );
}

/** Bluff: hunt for the real answer among everyone's lies. */
function BluffPickView({
  state,
  assignment,
  voted,
}: {
  state: RoomState;
  assignment: PlayerAssignment | null;
  voted?: boolean;
}) {
  const { t } = useI18n();
  const view = state.bluff;
  const q = view?.question ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setPicked(null);
    setError("");
  }, [q?.id]);

  if (!q || !view?.options) {
    return (
      <div className="player-body center fade-in">
        <h2>{t("tallyingVotes")}</h2>
        <div className="pulse-dot" />
      </div>
    );
  }

  const mine = assignment?.bluff?.questionId === q.id ? assignment.bluff : null;
  if (picked || mine?.pickedOptionId || voted) {
    return (
      <div className="player-body center fade-in">
        <h2>{t("bluffPicked")}</h2>
        <p className="hint">{t("waitingOthers")}</p>
        <div className="pulse-dot" />
      </div>
    );
  }

  const own = new Set(mine?.ownOptionIds ?? []);
  const pick = async (optionId: string) => {
    setPicked(optionId);
    setError("");
    playSfx("vote");
    haptic();
    const res = await emitAck("bluff:pick", { questionId: q.id, optionId });
    if (!res.ok) {
      setPicked(null);
      setError(t(errorKey(res.error)));
    }
  };

  return (
    <div className="player-body fade-in">
      <div className="answer-prompt center">{q.text}</div>
      <p className="hint center">{t("bluffPickTitle")}</p>
      <div className="bluff-options player">
        {view.options.map((option, i) => {
          const isOwn = own.has(option.optionId);
          return (
            <button
              key={option.optionId}
              className={`bluff-option ${isOwn ? "own" : ""}`}
              onClick={() => void pick(option.optionId)}
              disabled={isOwn}
              aria-label={t("ariaOption", { letter: OPTION_LETTERS[i], text: option.text })}
            >
              <span className="opt-letter">{OPTION_LETTERS[i]}</span>
              <span className="opt-text">{option.text}</span>
              {isOwn && <span className="bluff-credit">{t("bluffYourLie")}</span>}
            </button>
          );
        })}
      </div>
      {error && <div className="badge error shake" role="alert">{error}</div>}
    </div>
  );
}

/** Bluff: did you find the truth, and whose lie got you if not? */
function BluffPlayerResult({
  state,
  assignment,
  myPlayerId,
}: {
  state: RoomState;
  assignment: PlayerAssignment | null;
  myPlayerId: string;
}) {
  const { t } = useI18n();
  const view = state.bluff;
  const reveal = view?.reveal ?? null;
  const q = view?.question ?? null;
  const pickedId =
    assignment?.bluff && q && assignment.bluff.questionId === q.id
      ? assignment.bluff.pickedOptionId
      : null;
  const picked = reveal?.options.find((option) => option.optionId === pickedId) ?? null;
  const points =
    reveal?.pointsThisRound.find((entry) => entry.playerId === myPlayerId)?.points ?? 0;
  const foundTruth = picked?.isTruth ?? false;
  const revealKey = reveal ? (q?.id ?? "") : null;

  useEffect(() => {
    if (revealKey !== null) playSfx(foundTruth ? "correct" : "wrong");
  }, [revealKey, foundTruth]);

  if (!reveal) {
    return (
      <div className="player-body center fade-in">
        <h2>{t("resultsOnScreen")}</h2>
        <p className="hint">{t("lookAtTv")}</p>
      </div>
    );
  }

  const truth = reveal.options.find((option) => option.isTruth);
  return (
    <div className={`player-body center fade-in result-${foundTruth ? "right" : "wrong"}`}>
      <div className="verdict-emoji bounce-in">
        {foundTruth ? <VerdictRight /> : <VerdictWrong />}
      </div>
      <h2>{foundTruth ? t("bluffFoundTruth") : t("bluffFooled")}</h2>
      {picked && !picked.isTruth && (
        <p className="hint">
          {picked.authors.length > 0
            ? t("bluffLieBy", { name: picked.authors.map((a) => a.name).join(", ") })
            : t("bluffHouseLie")}
        </p>
      )}
      {!foundTruth && truth && (
        <p className="hint">
          {t("bluffTruth")}: <b>{truth.text}</b>
        </p>
      )}
      {points > 0 && <p className="big-score bounce-in">+{points}</p>}
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
  // Every broadcast delivers a fresh `reveal` object — a reconnect or a late
  // audience join during results would replay the jingle — so key the sound on
  // which question was revealed instead.
  const revealedId = reveal ? (question?.id ?? "") : null;

  useEffect(() => {
    if (revealedId !== null) playSfx(correct ? "correct" : "wrong");
  }, [revealedId, correct]);

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
      <div className="verdict-emoji bounce-in">{correct ? <VerdictRight /> : <VerdictWrong />}</div>
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
