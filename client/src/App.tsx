import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type {
  PlayerAssignment,
  RoomState,
  SessionResult,
} from "../../shared/src/index";
import { Home } from "./views/Home";
import { emitAck, socket } from "./socket";
import { errorKey, type TKey } from "./i18n/translations";
import { useI18n } from "./i18n";
import { useCountdown } from "./useCountdown";
import { RestoreScreen, RoomNotice } from "./components/Connection";
import { RoomErrorBoundary } from "./components/RoomErrorBoundary";

const HostScreen = lazy(() =>
  import("./views/HostScreen").then((module) => ({ default: module.HostScreen }))
);
const PlayerScreen = lazy(() =>
  import("./views/PlayerScreen").then((module) => ({
    default: module.PlayerScreen,
  }))
);

export type Role = "home" | "host" | "player";
type RoomRole = Exclude<Role, "home">;

/**
 * How the client currently stands with the server.
 *
 * `restoring` and `connecting` are transient; `unreachable` is terminal until
 * the player retries. Screens stay mounted for all of them — only a cold start
 * with nothing to show falls back to a full-screen state.
 */
export type Link = "connecting" | "restoring" | "live" | "unreachable";

const SESSION_KEY = "matah.session";
/** How long a restore may run before we admit the server is not answering. */
const RESTORE_TIMEOUT_MS = 8_000;

/**
 * What we persist to resume a room. `isAudience` is part of the wire result
 * but never read back — the live room state is the authority on that.
 */
interface StoredSession extends Omit<SessionResult, "isAudience"> {
  role: RoomRole;
}

declare global {
  interface Window {
    render_game_to_text?: () => string;
  }
}

function readSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredSession>;
    if (
      (value.role !== "host" && value.role !== "player") ||
      typeof value.code !== "string" ||
      !/^[A-Z]{4}$/.test(value.code) ||
      typeof value.playerId !== "string" ||
      value.playerId.length === 0 ||
      typeof value.resumeToken !== "string" ||
      value.resumeToken.length === 0
    ) {
      clearSession();
      return null;
    }
    return value as StoredSession;
  } catch {
    clearSession();
    return null;
  }
}

function writeSession(session: StoredSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // The active in-memory session remains usable when storage is unavailable.
  }
}

function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith("matah.drafts.")) sessionStorage.removeItem(key);
    }
  } catch {
    // Nothing else to clear.
  }
}

function clearJoinCode(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("code")) return;
  url.searchParams.delete("code");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function App() {
  const { t } = useI18n();
  const initialSession = useRef(readSession());
  const [role, setRole] = useState<Role>("home");
  const [code, setCode] = useState("");
  const [myPlayerId, setMyPlayerId] = useState("");
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [assignment, setAssignment] = useState<PlayerAssignment | null>(null);
  const [link, setLink] = useState<Link>(
    socket.connected ? "live" : "connecting"
  );
  const [leaving, setLeaving] = useState(false);
  const [notice, setNotice] = useState<TKey | undefined>();
  const restoredSocketId = useRef<string | null>(null);
  const rejoinRef = useRef<() => void>(() => {});
  const [retryToken, setRetryToken] = useState(0);
  const secondsLeft = useCountdown(roomState);
  const connected = link === "live";

  const resetToHome = useCallback((nextNotice?: TKey) => {
    clearSession();
    clearJoinCode();
    initialSession.current = null;
    setRole("home");
    setRoomState(null);
    setAssignment(null);
    setCode("");
    setMyPlayerId("");
    setLink(socket.connected ? "live" : "connecting");
    setLeaving(false);
    setNotice(nextNotice);
  }, []);

  useEffect(() => {
    const tryRejoin = async () => {
      const session = initialSession.current ?? readSession();
      if (!socket.connected) return;
      if (!session) {
        setLink("live");
        return;
      }
      if (restoredSocketId.current === socket.id) {
        setLink("live");
        return;
      }
      restoredSocketId.current = socket.id ?? null;
      setLink("restoring");
      const response = await emitAck<SessionResult>("room:rejoin", {
        code: session.code,
        resumeToken: session.resumeToken,
      });
      if (!response.ok) {
        if (response.error === "session_not_found") {
          resetToHome("errSessionExpired");
        } else {
          // Allow another attempt on the same socket, and say so — an in-room
          // role would otherwise sit on pre-disconnect state with no clue.
          restoredSocketId.current = null;
          setLink("unreachable");
          setNotice(errorKey(response.error));
        }
        return;
      }
      const { code: nextCode, playerId, resumeToken } = response.data;
      const restored: StoredSession = {
        code: nextCode,
        playerId,
        resumeToken,
        role: session.role,
      };
      initialSession.current = restored;
      writeSession(restored);
      setRole(restored.role);
      setCode(restored.code);
      setMyPlayerId(restored.playerId);
      setNotice(undefined);
      setLink("live");
    };
    rejoinRef.current = () => void tryRejoin();

    const onState = (state: RoomState) => setRoomState(state);
    const onAssignment = (nextAssignment: PlayerAssignment) =>
      setAssignment(nextAssignment);
    const onConnect = () => void tryRejoin();
    const onDisconnect = () =>
      setLink((current) => (current === "unreachable" ? current : "connecting"));
    // socket.io has exhausted its retries; nothing more will arrive on its own,
    // so say so rather than leaving a "connecting…" badge up indefinitely.
    const onGaveUp = () => {
      setLink("unreachable");
      setNotice("serverUnreachable");
    };
    const onKicked = () => resetToHome("kickedNotice");
    const onSessionReplaced = () => resetToHome("sessionReplacedNotice");

    socket.on("room:state", onState);
    socket.on("player:assignment", onAssignment);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.io.on("reconnect_failed", onGaveUp);
    socket.on("room:kicked", onKicked);
    socket.on("room:session-replaced", onSessionReplaced);
    if (socket.connected) void tryRejoin();

    return () => {
      socket.off("room:state", onState);
      socket.off("player:assignment", onAssignment);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.io.off("reconnect_failed", onGaveUp);
      socket.off("room:kicked", onKicked);
      socket.off("room:session-replaced", onSessionReplaced);
    };
  }, [resetToHome, retryToken]);

  // Without this, a stored session plus an unreachable server left the app on
  // a bare spinner forever: no timeout, no error, no way back.
  useEffect(() => {
    if (link === "live" || link === "unreachable") return undefined;
    const timer = window.setTimeout(
      () => setLink("unreachable"),
      RESTORE_TIMEOUT_MS
    );
    return () => window.clearTimeout(timer);
  }, [link]);

  const retry = useCallback(() => {
    restoredSocketId.current = null;
    setNotice(undefined);
    setLink(socket.connected ? "restoring" : "connecting");
    if (!socket.connected) socket.connect();
    else rejoinRef.current();
    setRetryToken((value) => value + 1);
  }, []);

  const enterRoom = (nextRole: RoomRole, result: SessionResult) => {
    const session: StoredSession = {
      code: result.code,
      playerId: result.playerId,
      resumeToken: result.resumeToken,
      role: nextRole,
    };
    initialSession.current = session;
    writeSession(session);
    clearJoinCode();
    setNotice(undefined);
    setRole(nextRole);
    setCode(result.code);
    setMyPlayerId(result.playerId);
  };

  const leave = async () => {
    if (leaving) return;
    setLeaving(true);
    await emitAck<null>("room:leave");
    resetToHome();
  };

  // Kept fresh per render, but installed once: rebuilding the hook on every
  // render churned a global for no benefit.
  const snapshotRef = useRef<() => string>(() => "{}");
  snapshotRef.current = () =>
    JSON.stringify({
      role,
      connected,
      link,
      leaving,
      code: code || null,
      playerId: myPlayerId || null,
      phase: roomState?.phase ?? null,
      phaseId: roomState?.phaseId ?? null,
      secondsLeft,
      gameType: roomState?.gameType ?? null,
      round: roomState?.round ?? 0,
      totalRounds: roomState?.totalRounds ?? 0,
      controllerPlayerId: roomState?.controllerPlayerId ?? null,
      players: roomState?.players.map((player) => ({
        id: player.id,
        name: player.name,
        score: player.score,
        connected: player.connected,
        submitted: player.hasSubmitted,
        voted: player.hasVoted,
      })) ?? [],
      audienceCount: roomState?.audience.length ?? 0,
      prompts: assignment?.prompts ?? [],
      activeMatchup: roomState?.quiplash?.activeMatchup ?? null,
      triviaQuestion: roomState?.trivia?.question ?? null,
      triviaReveal: roomState?.trivia?.reveal ?? null,
    });

  useEffect(() => {
    window.render_game_to_text = () => snapshotRef.current();
    return () => {
      delete window.render_game_to_text;
    };
  }, []);

  if (role === "home") {
    return (
      <Home
        onEnter={enterRoom}
        connected={connected}
        notice={notice}
        onDismissNotice={() => setNotice(undefined)}
        onRetryConnection={link === "unreachable" ? retry : undefined}
      />
    );
  }

  // The room screens render their own waiting states and keep their local UI
  // across a reconnect, so this is only for the one case with nothing left to
  // try: no room state, and the link has given up.
  if (roomState === null && link === "unreachable") {
    return (
      <RestoreScreen link={link} notice={notice} onRetry={retry} onLeave={leave} />
    );
  }

  const loading = (
    <main className="screen center" aria-busy="true">
      <div className="badge warn" role="status">
        {t("loading")}
      </div>
    </main>
  );

  return (
    <Suspense fallback={loading}>
      <RoomErrorBoundary code={code} onLeave={leave}>
        {notice && link !== "live" ? (
          <RoomNotice notice={notice} onRetry={retry} onDismiss={() => setNotice(undefined)} />
        ) : null}
        {role === "host" ? (
          <HostScreen
            code={code}
            state={roomState}
            secondsLeft={secondsLeft}
            connected={connected}
            leaving={leaving}
            onLeave={leave}
          />
        ) : (
          <PlayerScreen
            code={code}
            myPlayerId={myPlayerId}
            state={roomState}
            assignment={assignment}
            secondsLeft={secondsLeft}
            connected={connected}
            leaving={leaving}
            onLeave={leave}
          />
        )}
      </RoomErrorBoundary>
    </Suspense>
  );
}
