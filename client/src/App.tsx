import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type {
  PlayerAssignment,
  RoomState,
  SessionResult,
} from "../../shared/src/index";
import { Home } from "./views/Home";
import { emitAck, socket } from "./socket";
import { errorKey, type TKey } from "./i18n/translations";
import { useCountdown } from "./useCountdown";

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

const SESSION_KEY = "matah.session";

interface StoredSession extends SessionResult {
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
  const initialSession = useRef(readSession());
  const [role, setRole] = useState<Role>("home");
  const [code, setCode] = useState("");
  const [myPlayerId, setMyPlayerId] = useState("");
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [assignment, setAssignment] = useState<PlayerAssignment | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [restoring, setRestoring] = useState(initialSession.current !== null);
  const [leaving, setLeaving] = useState(false);
  const [notice, setNotice] = useState<TKey | undefined>();
  const restoredSocketId = useRef<string | null>(null);
  const secondsLeft = useCountdown(roomState);

  const resetToHome = useCallback((nextNotice?: TKey) => {
    clearSession();
    clearJoinCode();
    initialSession.current = null;
    setRole("home");
    setRoomState(null);
    setAssignment(null);
    setCode("");
    setMyPlayerId("");
    setRestoring(false);
    setLeaving(false);
    setNotice(nextNotice);
  }, []);

  useEffect(() => {
    const tryRejoin = async () => {
      const session = initialSession.current ?? readSession();
      if (!session || !socket.id || restoredSocketId.current === socket.id) {
        if (!session) setRestoring(false);
        return;
      }
      restoredSocketId.current = socket.id;
      setRestoring(true);
      const response = await emitAck<SessionResult>("room:rejoin", {
        code: session.code,
        resumeToken: session.resumeToken,
      });
      if (!response.ok) {
        if (response.error === "session_not_found") {
          resetToHome("errSessionExpired");
        } else {
          restoredSocketId.current = null;
          setRestoring(false);
          setNotice(errorKey(response.error));
        }
        return;
      }
      const restored: StoredSession = { ...response.data, role: session.role };
      initialSession.current = restored;
      writeSession(restored);
      setRole(restored.role);
      setCode(restored.code);
      setMyPlayerId(restored.playerId);
      setRestoring(false);
    };

    const onState = (state: RoomState) => setRoomState(state);
    const onAssignment = (nextAssignment: PlayerAssignment) =>
      setAssignment(nextAssignment);
    const onConnect = () => {
      setConnected(true);
      void tryRejoin();
    };
    const onDisconnect = () => setConnected(false);
    const onKicked = () => resetToHome("kickedNotice");
    const onSessionReplaced = () => resetToHome("sessionReplacedNotice");

    socket.on("room:state", onState);
    socket.on("player:assignment", onAssignment);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:kicked", onKicked);
    socket.on("room:session-replaced", onSessionReplaced);
    if (socket.connected) void tryRejoin();

    return () => {
      socket.off("room:state", onState);
      socket.off("player:assignment", onAssignment);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:kicked", onKicked);
      socket.off("room:session-replaced", onSessionReplaced);
    };
  }, [resetToHome]);

  const enterRoom = (nextRole: RoomRole, result: SessionResult) => {
    const session: StoredSession = { ...result, role: nextRole };
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

  useEffect(() => {
    window.render_game_to_text = () =>
      JSON.stringify({
        role,
        connected,
        restoring,
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
    return () => {
      delete window.render_game_to_text;
    };
  }, [assignment, code, connected, leaving, myPlayerId, restoring, role, roomState, secondsLeft]);

  if (restoring) {
    return (
      <main className="screen center" aria-busy="true">
        <div className="badge warn" role="status">
          …
        </div>
      </main>
    );
  }

  if (role === "home") {
    return (
      <Home
        onEnter={enterRoom}
        connected={connected}
        notice={notice}
        onDismissNotice={() => setNotice(undefined)}
      />
    );
  }

  const loading = (
    <main className="screen center" aria-busy="true">
      <div className="badge warn" role="status">…</div>
    </main>
  );

  return (
    <Suspense fallback={loading}>
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
    </Suspense>
  );
}
