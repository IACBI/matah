import { randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  AVATARS,
  DEFAULT_AVATAR,
  GAME_TYPES,
  LANGUAGES,
  MAX_ANSWER_LEN,
  MAX_NAME_LEN,
  REACTIONS,
  ROOM_CODE_LENGTH,
} from "../../shared/src/index.js";
import {
  BoundedRateLimiter,
  BoundedWindowRateLimiter,
  TokenBucket,
} from "./rateLimiter.js";
import { Room } from "./room.js";
import { safeIdentifier, sanitizeUserText } from "./util.js";

const PORT = Number(process.env.PORT ?? 3001);
const isProd = process.env.NODE_ENV === "production";
const allowedOrigins = [
  process.env.PUBLIC_ORIGIN ?? "",
  ...(process.env.ALLOWED_ORIGINS ?? "").split(","),
]
  .map((origin) => origin.trim())
  .filter((origin, index, all) => Boolean(origin) && all.indexOf(origin) === index);

if (isProd && allowedOrigins.length === 0) {
  throw new Error("PUBLIC_ORIGIN must contain an explicit production origin");
}

// Fail at boot rather than at the first handshake: an origin with a trailing
// slash, a missing scheme, or a stray path silently rejects every client,
// which looks like a networking fault rather than a typo.
for (const origin of allowedOrigins) {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error(`Not a valid origin: ${origin}`);
  }
  if (parsed.origin !== origin) {
    throw new Error(
      `Origins must have no path, query, or trailing slash: ${origin} (expected ${parsed.origin})`
    );
  }
  if (isProd && parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1") {
    throw new Error(`Production origins must use https: ${origin}`);
  }
}

/** Read a rate-limit tunable from the environment, falling back to the default. */
function limit(name: string, fallback: number): number {
  const raw = Number(process.env[`MATAH_RL_${name}`]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

// These are sized for a party, not a botnet. Every phone at the table shares
// one NAT'd address, so per-IP ceilings that look generous for a single user
// are the whole household's budget: after a Wi-Fi blip, eight clients running
// socket.io's retry ladder must all get back in.
const connectionLimiter = new BoundedRateLimiter(
  limit("CONN_BURST", 60),
  limit("CONN_REFILL", 2),
  10_000,
  10 * 60_000
);
const actionLimiter = new BoundedRateLimiter(
  limit("ACTION_BURST", 80),
  limit("ACTION_REFILL", 20),
  10_000,
  10 * 60_000
);
const roomCreateLimiter = new BoundedWindowRateLimiter(
  limit("CREATE", 10),
  10 * 60_000,
  10_000
);
const roomJoinLimiter = new BoundedWindowRateLimiter(
  limit("JOIN", 60),
  60_000,
  10_000
);
// Abuse means flooding one room, not one address — scoping these per room
// punishes the attacker instead of everyone behind the same router.
const roomJoinRoomLimiter = new BoundedWindowRateLimiter(
  limit("JOIN_ROOM", 40),
  60_000,
  10_000
);
// Every successful rejoin fans a full room state out to up to 29 members, so
// it needs its own ceiling rather than only the generic per-socket bucket.
const rejoinLimiter = new BoundedWindowRateLimiter(
  limit("REJOIN", 20),
  60_000,
  10_000
);
const reactionRoomLimiter = new BoundedRateLimiter(20, 20, 1_000, 10 * 60_000);

function clientAddress(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (isProd && typeof forwarded === "string") {
    // This deployment trusts exactly one edge proxy. Use the right-most hop so
    // a client-supplied leading X-Forwarded-For value cannot rotate rate-limit
    // identities when the edge appends the real address.
    return forwarded.split(",").at(-1)?.trim() || request.socket.remoteAddress || "unknown";
  }
  return request.socket.remoteAddress ?? "unknown";
}

function originAllowed(origin: string | undefined): boolean {
  return !isProd || (typeof origin === "string" && allowedOrigins.includes(origin));
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", "data:"],
          },
        }
      : false,
  })
);
app.use(compression());
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
  cors: { origin: isProd ? allowedOrigins : true },
  allowRequest: (request, callback) => {
    if (!originAllowed(request.headers.origin)) {
      callback("origin_not_allowed", false);
      return;
    }
    if (!connectionLimiter.take(clientAddress(request))) {
      callback("rate_limited", false);
      return;
    }
    callback(null, true);
  },
  maxHttpBufferSize: 4096,
  pingTimeout: 20_000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 120_000,
    skipMiddlewares: false,
  },
});

const rooms = new Map<string, Room>();
const MAX_ROOMS = 500;
const IDLE_MS = 30 * 60_000;
/** Everyone has dropped and nothing has happened since — reclaim sooner. */
const ABANDONED_IDLE_MS = 5 * 60_000;
const SWEEP_MS = 5 * 60_000;
const VACANT_RECHECK_MS = 125_000;

/** Test/diagnostic hook; room membership details remain private. */
export function activeRoomCount(): number {
  return rooms.size;
}

function sweepIdleRooms(): void {
  for (const [code, room] of rooms) {
    if (room.isStale(IDLE_MS, ABANDONED_IDLE_MS)) {
      room.dispose();
      rooms.delete(code);
    }
  }
}

/** Drop a room the moment its last member is gone. */
function deleteIfVacant(room: Room): void {
  if (rooms.get(room.code) === room && room.isVacant()) {
    room.dispose();
    rooms.delete(room.code);
  }
}

let sweepHandle: NodeJS.Timeout | null = null;

function makeRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  do {
    code = Array.from(
      { length: ROOM_CODE_LENGTH },
      () => alphabet[randomInt(alphabet.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

function normalizeCode(raw: unknown): string {
  return typeof raw === "string"
    ? raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, ROOM_CODE_LENGTH)
    : "";
}

io.on("connection", (socket) => {
  let joinedCode: string | null = null;
  const socketBucket = new TokenBucket(20, 10);
  const reactionBucket = new TokenBucket(3, 3);
  const ip = clientAddress(socket.request);

  if (socket.recovered) {
    for (const code of socket.rooms) {
      const room = rooms.get(code);
      const playerId = room?.recoverSocket(socket.id);
      if (room && playerId) {
        joinedCode = code;
        room.emit();
        room.resendAssignment(playerId);
        break;
      }
    }
  }

  const guard = <T>(
    callback: (result: ApiResult<T>) => void,
    eventName: string,
    action: () => ApiResult<T>,
    cost = 1
  ): void => {
    if (typeof callback !== "function") return;
    if (!socketBucket.take(cost) || !actionLimiter.take(ip, cost)) {
      callback({ ok: false, error: "rate_limited" });
      return;
    }
    let result: ApiResult<T>;
    try {
      result = action();
    } catch (error) {
      console.error("socket event failed", { eventName, socketId: socket.id, error });
      result = { ok: false, error: "server_error" };
    }
    // Deliver the coalesced broadcast before the acknowledgement, so a client
    // never acts on an ack that its own room state has not caught up to.
    if (joinedCode) rooms.get(joinedCode)?.flush();
    try {
      callback(result);
    } catch (error) {
      console.error("socket acknowledgement failed", {
        eventName,
        socketId: socket.id,
        error,
      });
    }
  };

  const currentSession = (): { room: Room; playerId: string } | null => {
    if (!joinedCode) return null;
    const room = rooms.get(joinedCode);
    const playerId = room?.pidForSocket(socket.id);
    return room && playerId ? { room, playerId } : null;
  };

  const leaveCurrentRoom = (): void => {
    if (!joinedCode) return;
    const room = rooms.get(joinedCode);
    if (room) {
      room.leaveBySocket(socket.id);
      socket.leave(room.code);
      deleteIfVacant(room);
    }
    joinedCode = null;
  };

  socket.on("room:create", (payload, callback) => {
    guard(callback, "room:create", () => {
      if (!roomCreateLimiter.take(ip)) return { ok: false, error: "rate_limited" };
      if (rooms.size >= MAX_ROOMS) return { ok: false, error: "server_busy" };
      const language = LANGUAGES.includes(payload?.language as Language)
        ? (payload.language as Language)
        : "tr";
      leaveCurrentRoom();
      const code = makeRoomCode();
      const room = new Room(
        code,
        language,
        (state) => io.to(code).emit("room:state", state),
        (socketId, assignment) =>
          io.to(socketId).emit("player:assignment", assignment)
      );
      rooms.set(code, room);
      const session = room.addHost(socket.id);
      socket.join(code);
      joinedCode = code;
      room.emit();
      return { ok: true, data: session };
    }, 10);
  });

  socket.on("room:join", (payload, callback) => {
    guard(callback, "room:join", () => {
      if (!roomJoinLimiter.take(ip)) return { ok: false, error: "rate_limited" };
      const code = normalizeCode(payload?.code);
      if (!rooms.has(code)) return { ok: false, error: "room_not_found" };
      if (!roomJoinRoomLimiter.take(code)) {
        return { ok: false, error: "rate_limited" };
      }
      const name = sanitizeUserText(payload?.name, MAX_NAME_LEN);
      if (!name) return { ok: false, error: "name_required" };
      const avatar = (AVATARS as readonly string[]).includes(payload?.avatar ?? "")
        ? (payload.avatar as string)
        : DEFAULT_AVATAR;
      // Release any seat this socket already holds *before* deciding whether
      // the room is full — otherwise re-joining your own full room counts your
      // own seat and demotes you to the audience.
      leaveCurrentRoom();
      const room = rooms.get(code);
      if (!room) return { ok: false, error: "room_not_found" };
      const asAudience = !room.inLobby() || room.isFull();
      if (asAudience && room.isAudienceFull()) {
        return { ok: false, error: "room_full" };
      }
      const session = room.addPlayer(socket.id, name, avatar, asAudience);
      socket.join(room.code);
      joinedCode = room.code;
      room.emit();
      return { ok: true, data: session };
    }, 3);
  });

  socket.on("room:rejoin", (payload, callback) => {
    guard(callback, "room:rejoin", () => {
      if (!rejoinLimiter.take(ip)) return { ok: false, error: "rate_limited" };
      const room = rooms.get(normalizeCode(payload?.code));
      if (!room) return { ok: false, error: "session_not_found" };
      const resumeToken =
        typeof payload?.resumeToken === "string" ? payload.resumeToken : "";
      const result = room.rejoin(resumeToken, socket.id);
      if (!result) return { ok: false, error: "session_not_found" };

      if (joinedCode && joinedCode !== room.code) leaveCurrentRoom();
      if (result.replacedSocketId) {
        io.to(result.replacedSocketId).emit("room:session-replaced");
        io.in(result.replacedSocketId).socketsLeave(room.code);
      }
      socket.join(room.code);
      joinedCode = room.code;
      room.emit();
      room.resendAssignment(result.playerId);
      const { code, playerId, resumeToken: rotatedToken, isAudience } = result;
      return {
        ok: true,
        data: { code, playerId, resumeToken: rotatedToken, isAudience },
      };
    }, 3);
  });

  socket.on("room:leave", (callback) => {
    guard(callback, "room:leave", () => {
      if (!currentSession()) return { ok: false, error: "no_room" };
      leaveCurrentRoom();
      return { ok: true, data: null };
    });
  });

  socket.on("room:setLanguage", (payload, callback) => {
    guard(callback, "room:setLanguage", () => {
      const current = currentSession();
      if (!current) return { ok: false, error: "no_room" };
      const controlError = current.room.controlError(
        current.playerId,
        payload?.phaseId,
        "language"
      );
      if (controlError) return { ok: false, error: controlError };
      if (!LANGUAGES.includes(payload?.language as Language)) {
        return { ok: false, error: "invalid_language" };
      }
      const error = current.room.setLanguage(payload.language as Language);
      return error
        ? { ok: false, error }
        : { ok: true, data: null };
    });
  });

  socket.on("game:start", (payload, callback) => {
    guard(callback, "game:start", () => {
      const current = currentSession();
      if (!current) return { ok: false, error: "no_room" };
      const controlError = current.room.controlError(
        current.playerId,
        payload?.phaseId,
        "start"
      );
      if (controlError) return { ok: false, error: controlError };
      const gameType = payload?.gameType as GameType;
      if (!GAME_TYPES.includes(gameType)) return { ok: false, error: "invalid_game" };
      const error = current.room.start(gameType, payload?.rounds);
      return error ? { ok: false, error } : { ok: true, data: null };
    });
  });

  socket.on("game:end", (payload, callback) => {
    guard(callback, "game:end", () => {
      const current = currentSession();
      if (!current) return { ok: false, error: "no_room" };
      const controlError = current.room.controlError(current.playerId, payload?.phaseId, "end");
      if (controlError) return { ok: false, error: controlError };
      const error = current.room.endGame();
      return error ? { ok: false, error } : { ok: true, data: null };
    });
  });

  socket.on("game:next", (payload, callback) => {
    guard(callback, "game:next", () => {
      const current = currentSession();
      if (!current) return { ok: false, error: "no_room" };
      const controlError = current.room.controlError(current.playerId, payload?.phaseId, "advance");
      if (controlError) return { ok: false, error: controlError };
      const error = current.room.next();
      return error ? { ok: false, error } : { ok: true, data: null };
    });
  });

  socket.on("game:restart", (payload, callback) => {
    guard(callback, "game:restart", () => {
      const current = currentSession();
      if (!current) return { ok: false, error: "no_room" };
      const controlError = current.room.controlError(current.playerId, payload?.phaseId, "restart");
      if (controlError) return { ok: false, error: controlError };
      const error = current.room.returnToLobby();
      return error ? { ok: false, error } : { ok: true, data: null };
    });
  });

  socket.on("game:rematch", (payload, callback) => {
    guard(callback, "game:rematch", () => {
      const current = currentSession();
      if (!current) return { ok: false, error: "no_room" };
      const controlError = current.room.controlError(current.playerId, payload?.phaseId, "rematch");
      if (controlError) return { ok: false, error: controlError };
      const error = current.room.rematch();
      return error ? { ok: false, error } : { ok: true, data: null };
    });
  });

  socket.on("player:kick", (payload, callback) => {
    guard(callback, "player:kick", () => {
      const current = currentSession();
      if (!current) return { ok: false, error: "no_room" };
      const controlError = current.room.controlError(current.playerId, payload?.phaseId, "kick");
      if (controlError) return { ok: false, error: controlError };
      const targetPlayerId = safeIdentifier(payload?.playerId, 64);
      if (!targetPlayerId || targetPlayerId === current.playerId) {
        return { ok: false, error: "invalid_target" };
      }
      const result = current.room.kick(targetPlayerId);
      if (!result.ok) return { ok: false, error: result.error ?? "invalid_target" };
      if (result.socketId) {
        io.to(result.socketId).emit("room:kicked");
        io.in(result.socketId).socketsLeave(current.room.code);
      }
      deleteIfVacant(current.room);
      return { ok: true, data: null };
    });
  });

  socket.on("answer:submit", (payload, callback) => {
    guard(callback, "answer:submit", () => {
      const current = currentSession();
      if (!current) return { ok: false, error: "no_room" };
      const accepted = current.room.submitAnswer(
        current.playerId,
        safeIdentifier(payload?.matchupId, 64),
        sanitizeUserText(payload?.text, MAX_ANSWER_LEN)
      );
      return accepted
        ? { ok: true, data: null }
        : { ok: false, error: "submit_failed" };
    });
  });

  socket.on("vote:submit", (payload, callback) => {
    guard(callback, "vote:submit", () => {
      const current = currentSession();
      if (!current) return { ok: false, error: "no_room" };
      const accepted = current.room.submitVote(
        current.playerId,
        safeIdentifier(payload?.matchupId, 64),
        safeIdentifier(payload?.answerId, 64)
      );
      return accepted
        ? { ok: true, data: null }
        : { ok: false, error: "vote_failed" };
    });
  });

  socket.on("trivia:answer", (payload, callback) => {
    guard(callback, "trivia:answer", () => {
      const current = currentSession();
      if (!current) return { ok: false, error: "no_room" };
      if (typeof payload?.optionIndex !== "number" || !Number.isInteger(payload.optionIndex)) {
        return { ok: false, error: "submit_failed" };
      }
      const accepted = current.room.submitTriviaAnswer(
        current.playerId,
        safeIdentifier(payload?.questionId, 64),
        payload.optionIndex
      );
      return accepted
        ? { ok: true, data: null }
        : { ok: false, error: "submit_failed" };
    });
  });

  socket.on("reaction:send", (payload, callback) => {
    guard(callback, "reaction:send", () => {
      const current = currentSession();
      if (!current) return { ok: false, error: "no_room" };
      if (!reactionBucket.take() || !reactionRoomLimiter.take(current.room.code)) {
        return { ok: false, error: "rate_limited" };
      }
      const emoji = safeIdentifier(payload?.emoji, 8);
      if (!(REACTIONS as readonly string[]).includes(emoji)) {
        return { ok: false, error: "invalid_reaction" };
      }
      const sender = current.room.getReactionSender(current.playerId);
      if (!sender) return { ok: false, error: "no_room" };
      io.to(current.room.code).emit("room:reaction", { ...sender, emoji });
      return { ok: true, data: null };
    });
  });

  socket.on("disconnect", () => {
    const current = currentSession();
    if (!current) return;
    current.room.handleDisconnect(socket.id);
    current.room.emit();
    setTimeout(() => deleteIfVacant(current.room), VACANT_RECHECK_MS).unref();
  });
});

if (isProd) {
  // npm workspaces launches `npm --workspace server run start` with cwd set to
  // `/server`, while Render and Docker launch from the repository root.
  const rootCandidate = path.resolve(process.cwd(), "client/dist");
  const clientDist = existsSync(rootCandidate)
    ? rootCandidate
    : path.resolve(process.cwd(), "../client/dist");
  const indexPath = path.join(clientDist, "index.html");
  if (!existsSync(indexPath)) {
    // Tests import this module with NODE_ENV=production to exercise the origin
    // allowlist without building the client. Degrade to an API-only server
    // instead of throwing at import time.
    console.warn(
      `client bundle not found at ${clientDist} — serving API and Socket.IO only`
    );
  } else {
    const publicOrigin = allowedOrigins[0];
    const indexHtml = readFileSync(indexPath, "utf8")
      .replaceAll("__PUBLIC_ORIGIN__", publicOrigin);
    app.use(
      express.static(clientDist, {
        index: false,
        dotfiles: "deny",
        setHeaders: (response, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          } else {
            response.setHeader("Cache-Control", "no-cache");
          }
        },
      })
    );
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.type("html").send(indexHtml);
    });
  }
}

let shuttingDown = false;
export function startServer(port = PORT): Promise<number> {
  if (!sweepHandle) {
    sweepIdleRooms();
    sweepHandle = setInterval(sweepIdleRooms, SWEEP_MS);
    sweepHandle.unref();
  }
  if (httpServer.listening) {
    const address = httpServer.address();
    return Promise.resolve(typeof address === "object" && address ? address.port : port);
  }
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    httpServer.once("error", onError);
    httpServer.listen(port, () => {
      httpServer.off("error", onError);
      const address = httpServer.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      console.log(`🎉 Matah server on http://localhost:${actualPort} (prod=${isProd})`);
      resolve(actualPort);
    });
  });
}

export function stopServer(): Promise<void> {
  if (sweepHandle) clearInterval(sweepHandle);
  sweepHandle = null;
  for (const room of rooms.values()) room.dispose();
  rooms.clear();
  if (!httpServer.listening) return Promise.resolve();
  return new Promise((resolve) => io.close(() => resolve()));
}

const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing Matah server`);
  void stopServer().then(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};

const isDirectEntry = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;

if (isDirectEntry) {
  void startServer().catch((error) => {
    console.error("Failed to start Matah server", error);
    process.exit(1);
  });
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
