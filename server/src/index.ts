import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import compression from "compression";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { Server } from "socket.io";
import type {
  ApiResult,
  ClientToServerEvents,
  GameType,
  Language,
  ServerToClientEvents,
} from "../../shared/src/index.js";
import {
  GAME_TYPES,
  LANGUAGES,
  MAX_ANSWER_LEN,
  MAX_NAME_LEN,
  ROOM_CODE_LENGTH,
} from "../../shared/src/index.js";
import { Room } from "./room.js";
import { TokenBucket } from "./rateLimiter.js";

const PORT = Number(process.env.PORT ?? 3001);
const isProd = process.env.NODE_ENV === "production";
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "*";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // behind a hosting proxy (Render/Railway/etc.)

// Security headers. CSP is relaxed enough for the bundled SPA + websockets.
app.use(
  helmet({
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            // Same-origin Socket.IO only; wss for the secure WebSocket upgrade.
            connectSrc: ["'self'", "wss:"],
            fontSrc: ["'self'", "data:"],
          },
        }
      : false,
  })
);
app.use(compression());

// Basic HTTP rate limit for the few REST endpoints we expose.
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
  // Drop oversized payloads early; our messages are tiny.
  maxHttpBufferSize: 4096,
  pingTimeout: 20_000,
  // Seamlessly ride out brief network blips: the socket keeps its id and room
  // membership and any room:state broadcasts missed during the gap are
  // replayed on reconnect. Longer drops fall back to the explicit pid rejoin.
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60_000,
    skipMiddlewares: true,
  },
});

const rooms = new Map<string, Room>();

const MAX_ROOMS = 500; // cap concurrent rooms to bound memory
const IDLE_MS = 30 * 60_000; // drop rooms idle for 30 min
const SWEEP_MS = 5 * 60_000;

// Periodically reclaim abandoned rooms (e.g. host left mid-game and never
// returned). Empty rooms are also handled faster by the disconnect handler.
setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.isStale(IDLE_MS)) {
      room.dispose();
      rooms.delete(code);
    }
  }
}, SWEEP_MS).unref();

function makeRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O to avoid confusion
  let code = "";
  do {
    code = Array.from(
      { length: ROOM_CODE_LENGTH },
      () => alphabet[Math.floor(Math.random() * alphabet.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

function normalizeCode(raw: unknown): string {
  return typeof raw === "string"
    ? raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, ROOM_CODE_LENGTH)
    : "";
}

function safeString(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.slice(0, max) : "";
}

io.on("connection", (socket) => {
  let joinedCode: string | null = null;
  let myPid: string | null = null; // stable player id, survives reconnects
  const bucket = new TokenBucket(20, 10); // 20 burst, 10/sec sustained

  // Connection state recovery restored this socket's id and room membership
  // after a brief drop. Re-bind our per-connection state and mark the player
  // back online immediately, without waiting for the client's explicit rejoin.
  if (socket.recovered) {
    for (const code of socket.rooms) {
      const room = rooms.get(code);
      const pid = room?.pidForSocket(socket.id);
      if (room && pid && room.rejoin(pid, socket.id)) {
        joinedCode = code;
        myPid = pid;
        room.emit();
        room.resendAssignment(pid);
        break;
      }
    }
  }

  const guard = <T>(
    cb: (res: ApiResult<T>) => void,
    fn: () => ApiResult<T>
  ): void => {
    if (typeof cb !== "function") return;
    if (!bucket.take()) return cb({ ok: false, error: "rate_limited" });
    try {
      cb(fn());
    } catch {
      cb({ ok: false, error: "server_error" });
    }
  };

  const currentRoom = (): Room | null =>
    joinedCode ? rooms.get(joinedCode) ?? null : null;

  socket.on("room:create", (payload, cb) => {
    guard(cb, () => {
      if (rooms.size >= MAX_ROOMS) return { ok: false, error: "server_busy" };
      const language = (
        LANGUAGES.includes((payload?.language as Language))
          ? payload.language
          : "tr"
      ) as Language;
      const code = makeRoomCode();
      const room = new Room(
        code,
        language,
        (state) => io.to(code).emit("room:state", state),
        (socketId, assignment) =>
          io.to(socketId).emit("player:assignment", assignment)
      );
      rooms.set(code, room);
      myPid = room.addHost(socket.id);
      socket.join(code);
      joinedCode = code;
      room.emit();
      return { ok: true, data: { code, playerId: myPid } };
    });
  });

  socket.on("room:join", (payload, cb) => {
    guard(cb, () => {
      const room = rooms.get(normalizeCode(payload?.code));
      if (!room) return { ok: false, error: "room_not_found" };
      if (!room.inLobby()) return { ok: false, error: "game_started" };
      if (room.isFull()) return { ok: false, error: "room_full" };
      const name = safeString(payload?.name, MAX_NAME_LEN).trim();
      if (!name) return { ok: false, error: "name_required" };
      myPid = room.addPlayer(socket.id, name);
      socket.join(room.code);
      joinedCode = room.code;
      room.emit();
      return { ok: true, data: { code: room.code, playerId: myPid } };
    });
  });

  socket.on("room:rejoin", (payload, cb) => {
    guard(cb, () => {
      const room = rooms.get(normalizeCode(payload?.code));
      const playerId = safeString(payload?.playerId, 64);
      if (!room || !room.rejoin(playerId, socket.id))
        return { ok: false, error: "session_not_found" };
      myPid = playerId;
      socket.join(room.code);
      joinedCode = room.code;
      room.emit();
      room.resendAssignment(playerId); // restore in-flight prompts
      return { ok: true, data: { code: room.code, playerId } };
    });
  });

  socket.on("game:start", (payload, cb) => {
    guard(cb, () => {
      const room = currentRoom();
      if (!room || !myPid) return { ok: false, error: "no_room" };
      if (!room.isHost(myPid)) return { ok: false, error: "host_only" };
      const gameType = payload?.gameType as GameType;
      if (!GAME_TYPES.includes(gameType))
        return { ok: false, error: "invalid_game" };
      const res = room.start(gameType);
      return res.ok
        ? { ok: true, data: null }
        : { ok: false, error: res.error! };
    });
  });

  socket.on("game:next", (cb) => {
    guard(cb, () => {
      const room = currentRoom();
      if (!room || !myPid) return { ok: false, error: "no_room" };
      if (!room.isHost(myPid)) return { ok: false, error: "host_only" };
      room.next();
      return { ok: true, data: null };
    });
  });

  socket.on("game:restart", (cb) => {
    guard(cb, () => {
      const room = currentRoom();
      if (!room || !myPid) return { ok: false, error: "no_room" };
      if (!room.isHost(myPid)) return { ok: false, error: "host_only" };
      room.returnToLobby();
      return { ok: true, data: null };
    });
  });

  socket.on("answer:submit", (payload, cb) => {
    guard(cb, () => {
      const room = currentRoom();
      if (!room || !myPid) return { ok: false, error: "no_room" };
      const ok = room.submitAnswer(
        myPid,
        safeString(payload?.matchupId, 64),
        safeString(payload?.text, MAX_ANSWER_LEN)
      );
      return ok ? { ok: true, data: null } : { ok: false, error: "submit_failed" };
    });
  });

  socket.on("vote:submit", (payload, cb) => {
    guard(cb, () => {
      const room = currentRoom();
      if (!room || !myPid) return { ok: false, error: "no_room" };
      const ok = room.submitVote(
        myPid,
        safeString(payload?.matchupId, 64),
        safeString(payload?.answerPlayerId, 64)
      );
      return ok ? { ok: true, data: null } : { ok: false, error: "vote_failed" };
    });
  });

  socket.on("trivia:answer", (payload, cb) => {
    guard(cb, () => {
      const room = currentRoom();
      if (!room || !myPid) return { ok: false, error: "no_room" };
      const idx = Number(payload?.optionIndex);
      const ok = room.submitTriviaAnswer(
        myPid,
        safeString(payload?.questionId, 64),
        idx
      );
      return ok ? { ok: true, data: null } : { ok: false, error: "submit_failed" };
    });
  });

  socket.on("disconnect", () => {
    const room = currentRoom();
    if (!room) return;
    room.handleDisconnect(socket.id);
    room.emit();
    setTimeout(() => {
      // Identity check: only reclaim if this exact room still occupies the
      // code (it may have been swept and the code reused by a new room).
      if (rooms.get(room.code) === room && room.isEmpty()) {
        room.dispose();
        rooms.delete(room.code);
      }
    }, 60_000).unref();
  });
});

// In production, serve the built client from the same origin as the API.
if (isProd) {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = path.resolve(dirname, "../../client/dist");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

httpServer.listen(PORT, () => {
  console.log(`🎉 Quibble server on http://localhost:${PORT} (prod=${isProd})`);
});
