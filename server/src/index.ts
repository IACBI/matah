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
            connectSrc: ["'self'", "ws:", "wss:"],
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
});

const rooms = new Map<string, Room>();

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
  const bucket = new TokenBucket(20, 10); // 20 burst, 10/sec sustained

  const guard = <T>(
    cb: (res: ApiResult<T>) => void,
    fn: () => ApiResult<T>
  ): void => {
    if (typeof cb !== "function") return;
    if (!bucket.take()) return cb({ ok: false, error: "Çok fazla istek" });
    try {
      cb(fn());
    } catch {
      cb({ ok: false, error: "Sunucu hatası" });
    }
  };

  const currentRoom = (): Room | null =>
    joinedCode ? rooms.get(joinedCode) ?? null : null;

  socket.on("room:create", (payload, cb) => {
    guard(cb, () => {
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
        (playerId, assignment) =>
          io.to(playerId).emit("player:assignment", assignment)
      );
      rooms.set(code, room);
      room.addHost(socket.id);
      socket.join(code);
      joinedCode = code;
      room.emit();
      return { ok: true, data: { code, playerId: socket.id } };
    });
  });

  socket.on("room:join", (payload, cb) => {
    guard(cb, () => {
      const room = rooms.get(normalizeCode(payload?.code));
      if (!room) return { ok: false, error: "Oda bulunamadı" };
      if (!room.inLobby()) return { ok: false, error: "Oyun çoktan başladı" };
      if (room.isFull()) return { ok: false, error: "Oda dolu" };
      const name = safeString(payload?.name, MAX_NAME_LEN).trim();
      if (!name) return { ok: false, error: "İsim gerekli" };
      room.addPlayer(socket.id, name);
      socket.join(room.code);
      joinedCode = room.code;
      room.emit();
      return { ok: true, data: { code: room.code, playerId: socket.id } };
    });
  });

  socket.on("room:rejoin", (payload, cb) => {
    guard(cb, () => {
      const room = rooms.get(normalizeCode(payload?.code));
      const playerId = safeString(payload?.playerId, 64);
      if (!room || !room.hasPlayer(playerId))
        return { ok: false, error: "Oturum bulunamadı" };
      room.setConnected(playerId, true);
      socket.join(room.code);
      joinedCode = room.code;
      room.emit();
      return { ok: true, data: { code: room.code, playerId } };
    });
  });

  socket.on("game:start", (payload, cb) => {
    guard(cb, () => {
      const room = currentRoom();
      if (!room) return { ok: false, error: "Oda yok" };
      const gameType = payload?.gameType as GameType;
      if (!GAME_TYPES.includes(gameType))
        return { ok: false, error: "Geçersiz oyun" };
      const res = room.start(gameType);
      return res.ok
        ? { ok: true, data: null }
        : { ok: false, error: res.error! };
    });
  });

  socket.on("game:next", (cb) => {
    guard(cb, () => {
      const room = currentRoom();
      if (!room) return { ok: false, error: "Oda yok" };
      room.next();
      return { ok: true, data: null };
    });
  });

  socket.on("answer:submit", (payload, cb) => {
    guard(cb, () => {
      const room = currentRoom();
      if (!room) return { ok: false, error: "Oda yok" };
      const ok = room.submitAnswer(
        socket.id,
        safeString(payload?.matchupId, 64),
        safeString(payload?.text, MAX_ANSWER_LEN)
      );
      return ok ? { ok: true, data: null } : { ok: false, error: "Gönderilemedi" };
    });
  });

  socket.on("vote:submit", (payload, cb) => {
    guard(cb, () => {
      const room = currentRoom();
      if (!room) return { ok: false, error: "Oda yok" };
      const ok = room.submitVote(
        socket.id,
        safeString(payload?.matchupId, 64),
        safeString(payload?.answerPlayerId, 64)
      );
      return ok ? { ok: true, data: null } : { ok: false, error: "Oy verilemedi" };
    });
  });

  socket.on("trivia:answer", (payload, cb) => {
    guard(cb, () => {
      const room = currentRoom();
      if (!room) return { ok: false, error: "Oda yok" };
      const idx = Number(payload?.optionIndex);
      const ok = room.submitTriviaAnswer(
        socket.id,
        safeString(payload?.questionId, 64),
        idx
      );
      return ok ? { ok: true, data: null } : { ok: false, error: "Gönderilemedi" };
    });
  });

  socket.on("disconnect", () => {
    const room = currentRoom();
    if (!room) return;
    room.setConnected(socket.id, false);
    room.emit();
    setTimeout(() => {
      if (room.isEmpty()) {
        room.dispose();
        rooms.delete(room.code);
      }
    }, 60_000);
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
