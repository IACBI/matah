import { useEffect, useState } from "react";
import type { PlayerAssignment, RoomState } from "../../shared/src/index";
import { socket } from "./socket";
import { Home } from "./views/Home";
import { HostScreen } from "./views/HostScreen";
import { PlayerScreen } from "./views/PlayerScreen";

export type Role = "home" | "host" | "player";

const SESSION_KEY = "quibble.session";

interface Session {
  role: Role;
  code: string;
  playerId: string;
}

export function App() {
  const [role, setRole] = useState<Role>("home");
  const [code, setCode] = useState<string>("");
  const [myPlayerId, setMyPlayerId] = useState<string>("");
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [assignment, setAssignment] = useState<PlayerAssignment | null>(null);
  const [connected, setConnected] = useState(socket.connected);

  // Wire up socket listeners once.
  useEffect(() => {
    const onState = (state: RoomState) => setRoomState(state);
    const onAssignment = (a: PlayerAssignment) => setAssignment(a);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on("room:state", onState);
    socket.on("player:assignment", onAssignment);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("room:state", onState);
      socket.off("player:assignment", onAssignment);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  // Try to restore a session after a reload / reconnect.
  useEffect(() => {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    let session: Session;
    try {
      session = JSON.parse(raw);
    } catch {
      return;
    }
    const rejoin = () => {
      socket.emit(
        "room:rejoin",
        { code: session.code, playerId: session.playerId },
        (res) => {
          if (res.ok) {
            setRole(session.role);
            setCode(session.code);
            setMyPlayerId(res.data.playerId);
          } else {
            sessionStorage.removeItem(SESSION_KEY);
          }
        }
      );
    };
    if (socket.connected) rejoin();
    else socket.once("connect", rejoin);
  }, []);

  const enterRoom = (nextRole: Role, nextCode: string, playerId: string) => {
    setRole(nextRole);
    setCode(nextCode);
    setMyPlayerId(playerId);
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ role: nextRole, code: nextCode, playerId })
    );
  };

  const leave = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setRole("home");
    setRoomState(null);
    setAssignment(null);
    setCode("");
  };

  if (role === "home") {
    return <Home onEnter={enterRoom} connected={connected} />;
  }

  if (role === "host") {
    return (
      <HostScreen
        code={code}
        state={roomState}
        connected={connected}
        onLeave={leave}
      />
    );
  }

  return (
    <PlayerScreen
      code={code}
      myPlayerId={myPlayerId}
      state={roomState}
      assignment={assignment}
      connected={connected}
      onLeave={leave}
    />
  );
}
